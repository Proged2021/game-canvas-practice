import { db } from "@/lib/db";
import { connectorAuthenticated, cleanupRelay } from "@/lib/lllm-relay";
import { MAX_PARTS, validJobId, validPart, validCiphertext, relayJson, boundedRelayBody } from "@/lib/lllm-policy";
import { LLLM_MEMBER_ACCOUNTS_SQL, LLLM_WORKSPACES_SQL, lllmActor } from "@/lib/lllm-workspaces";

const authorizedJob = `j.workspace_id IN (${LLLM_WORKSPACES_SQL})
  AND j.account_key IN (${LLLM_MEMBER_ACCOUNTS_SQL})
  AND EXISTS (SELECT 1 FROM workspace_extensions e WHERE e.workspace_id=j.workspace_id AND e.extension_id='lllm' AND e.enabled=1)
  AND EXISTS (SELECT 1 FROM account_memberships m WHERE m.workspace_id=j.workspace_id AND m.account_key=j.account_key)`;
const activeJob = `FROM lllm_bridge_jobs j WHERE j.id=?1 AND j.state='claimed' AND j.expires_at>?2 AND ${authorizedJob}`;

export async function POST(request: Request) {
  if (!await connectorAuthenticated(request)) return relayJson({ error: "Unauthorized" }, 401);
  let b; try { b = await boundedRelayBody(request); } catch { return relayJson({ error: "Invalid request" }, 400); }
  if (b.action === "poll" || b.action === "boot") {
    await cleanupRelay();
    await db().prepare("INSERT INTO lllm_bridge_state(id,last_seen) VALUES ('server',?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen").bind(Date.now()).run();
    // Never replay an operation interrupted by a controller restart.
    if (b.action === "boot") {
      await db().batch([
        db().prepare("DELETE FROM lllm_bridge_chunks WHERE job_id IN (SELECT id FROM lllm_bridge_jobs WHERE state='claimed')"),
        db().prepare("UPDATE lllm_bridge_jobs SET state='failed',expires_at=? WHERE state='claimed'").bind(Date.now() + 60_000),
      ]);
    }
    const activeIds = Array.isArray(b.active) ? b.active.filter(validJobId).slice(0, 16) : [];
    const active = [];
    for (const id of activeIds) {
      const exists = await db().prepare(`SELECT j.id FROM lllm_bridge_jobs j JOIN workspace_extensions e ON e.workspace_id=j.workspace_id AND e.extension_id='lllm' AND e.enabled=1
        JOIN account_memberships m ON m.workspace_id=j.workspace_id AND m.account_key=j.account_key WHERE j.id=? AND j.workspace_id IN (${LLLM_WORKSPACES_SQL})
          AND j.account_key IN (${LLLM_MEMBER_ACCOUNTS_SQL}) AND j.state='claimed' AND j.expires_at>?`).bind(id, Date.now()).first();
      if (exists) active.push(id);
    }
    const ready = await db().prepare(`SELECT j.id,j.workspace_id,j.account_key,j.request_parts FROM lllm_bridge_jobs j
      JOIN workspace_extensions e ON e.workspace_id=j.workspace_id AND e.extension_id='lllm' AND e.enabled=1
      JOIN account_memberships m ON m.workspace_id=j.workspace_id AND m.account_key=j.account_key
      WHERE j.workspace_id IN (${LLLM_WORKSPACES_SQL}) AND j.account_key IN (${LLLM_MEMBER_ACCOUNTS_SQL})
        AND j.state='ready' AND j.expires_at>? ORDER BY j.created_at LIMIT 8`).bind(Date.now()).all<{ id: string; workspace_id: string; account_key: string; request_parts: number }>();
    const jobs = [];
    for (const job of ready.results.slice(0, Math.max(0, 12 - activeIds.length))) {
      const claimed = await db().prepare(`UPDATE lllm_bridge_jobs AS j SET state='claimed'
        WHERE j.id=?1 AND j.state='ready' AND j.expires_at>?2 AND ${authorizedJob}`).bind(job.id, Date.now()).run();
      if (claimed.meta.changes) jobs.push({ id: job.id, request_parts: job.request_parts,
        account_key: await lllmActor(job.workspace_id, job.account_key) });
    }
    return relayJson({ jobs, active });
  }
  if (!validJobId(b.id)) return relayJson({ error: "Invalid job" }, 400);
  const job = await db().prepare(`SELECT j.request_parts ${activeJob}`).bind(b.id, Date.now()).first<{ request_parts: number }>();
  if (!job) return relayJson({ error: "Expired or revoked" }, 404);
  if (b.action === "read" && validPart(b.part) && b.part < job.request_parts) {
    const chunk = await db().prepare(`SELECT c.ciphertext FROM lllm_bridge_chunks c
      WHERE c.job_id=?1 AND c.direction='request' AND c.part=?3
        AND EXISTS (SELECT 1 ${activeJob} AND c.part<j.request_parts)`)
      .bind(b.id, Date.now(), b.part).first();
    return chunk ? relayJson(chunk) : relayJson({ error: "Missing chunk" }, 404);
  }
  if (b.action === "write" && validPart(b.part) && validCiphertext(b.ciphertext)) {
    const written = await db().prepare(`INSERT INTO lllm_bridge_chunks(job_id,direction,part,ciphertext)
      SELECT j.id,'response',?3,?4 ${activeJob}
      ON CONFLICT(job_id,direction,part) DO UPDATE SET ciphertext=lllm_bridge_chunks.ciphertext`)
      .bind(b.id, Date.now(), b.part, b.ciphertext).run();
    return written.meta.changes ? relayJson({ ok: true }) : relayJson({ error: "Expired or revoked" }, 404);
  }
  if (b.action === "complete" && Number.isInteger(b.parts) && b.parts > 0 && b.parts <= MAX_PARTS) {
    const updated = await db().prepare(`UPDATE lllm_bridge_jobs AS j SET state='done',response_parts=?3,expires_at=?4
      WHERE j.id=?1 AND j.state='claimed' AND j.expires_at>?2 AND ${authorizedJob}
        AND (SELECT COUNT(*) FROM lllm_bridge_chunks WHERE job_id=?1 AND direction='response')=?3`)
      .bind(b.id, Date.now(), b.parts, Date.now() + 120_000).run();
    if (!updated.meta.changes) return relayJson({ error: "Incomplete" }, 409);
    await db().prepare("DELETE FROM lllm_bridge_chunks WHERE job_id=? AND direction='request'").bind(b.id).run();
    return relayJson({ ok: true });
  }
  if (b.action === "fail") {
    const failed = await db().batch([
      db().prepare(`DELETE FROM lllm_bridge_chunks WHERE job_id=?1 AND EXISTS (SELECT 1 ${activeJob})`).bind(b.id, Date.now()),
      db().prepare(`UPDATE lllm_bridge_jobs AS j SET state='failed',expires_at=?3
        WHERE j.id=?1 AND j.state='claimed' AND j.expires_at>?2 AND ${authorizedJob}`).bind(b.id, Date.now(), Date.now() + 60_000),
    ]);
    return failed[1].meta.changes ? relayJson({ ok: true }) : relayJson({ error: "Expired or revoked" }, 404);
  }
  return relayJson({ error: "Invalid operation" }, 400);
}
