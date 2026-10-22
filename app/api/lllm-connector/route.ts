import { db } from "@/lib/db";
import { connectorAuthenticated, cleanupRelay } from "@/lib/lllm-relay";
import { LLLM_WORKSPACE_ID, MAX_PARTS, validJobId, validPart, validCiphertext, relayJson, boundedRelayBody } from "@/lib/lllm-policy";

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
        JOIN account_memberships m ON m.workspace_id=j.workspace_id AND m.account_key=j.account_key WHERE j.id=? AND j.state='claimed' AND j.expires_at>?`).bind(id, Date.now()).first();
      if (exists) active.push(id);
    }
    const ready = await db().prepare(`SELECT j.id,j.account_key,j.request_parts FROM lllm_bridge_jobs j
      JOIN workspace_extensions e ON e.workspace_id=j.workspace_id AND e.extension_id='lllm' AND e.enabled=1
      JOIN account_memberships m ON m.workspace_id=j.workspace_id AND m.account_key=j.account_key
      WHERE j.workspace_id=? AND j.state='ready' AND j.expires_at>? ORDER BY j.created_at LIMIT 8`).bind(LLLM_WORKSPACE_ID, Date.now()).all<{ id: string; account_key: string; request_parts: number }>();
    const jobs = [];
    for (const job of ready.results.slice(0, Math.max(0, 12 - activeIds.length))) {
      const claimed = await db().prepare("UPDATE lllm_bridge_jobs SET state='claimed' WHERE id=? AND state='ready'").bind(job.id).run();
      if (claimed.meta.changes) jobs.push(job);
    }
    return relayJson({ jobs, active });
  }
  if (!validJobId(b.id)) return relayJson({ error: "Invalid job" }, 400);
  const job = await db().prepare(`SELECT j.* FROM lllm_bridge_jobs j
    JOIN workspace_extensions e ON e.workspace_id=j.workspace_id AND e.extension_id='lllm' AND e.enabled=1
    JOIN account_memberships m ON m.workspace_id=j.workspace_id AND m.account_key=j.account_key
    WHERE j.id=? AND j.workspace_id=? AND j.state='claimed' AND j.expires_at>?`).bind(b.id, LLLM_WORKSPACE_ID, Date.now()).first<{ request_parts: number }>();
  if (!job) return relayJson({ error: "Expired or revoked" }, 404);
  if (b.action === "read" && validPart(b.part) && b.part < job.request_parts) {
    const chunk = await db().prepare("SELECT ciphertext FROM lllm_bridge_chunks WHERE job_id=? AND direction='request' AND part=?").bind(b.id, b.part).first();
    return chunk ? relayJson(chunk) : relayJson({ error: "Missing chunk" }, 404);
  }
  if (b.action === "write" && validPart(b.part) && validCiphertext(b.ciphertext)) {
    await db().prepare("INSERT INTO lllm_bridge_chunks(job_id,direction,part,ciphertext) VALUES (?,'response',?,?) ON CONFLICT(job_id,direction,part) DO NOTHING").bind(b.id, b.part, b.ciphertext).run();
    return relayJson({ ok: true });
  }
  if (b.action === "complete" && Number.isInteger(b.parts) && b.parts > 0 && b.parts <= MAX_PARTS) {
    const updated = await db().prepare("UPDATE lllm_bridge_jobs SET state='done',response_parts=?,expires_at=? WHERE id=? AND state='claimed' AND (SELECT COUNT(*) FROM lllm_bridge_chunks WHERE job_id=? AND direction='response')=?")
      .bind(b.parts, Date.now() + 120_000, b.id, b.id, b.parts).run();
    if (!updated.meta.changes) return relayJson({ error: "Incomplete" }, 409);
    await db().prepare("DELETE FROM lllm_bridge_chunks WHERE job_id=? AND direction='request'").bind(b.id).run();
    return relayJson({ ok: true });
  }
  if (b.action === "fail") {
    await db().batch([
      db().prepare("DELETE FROM lllm_bridge_chunks WHERE job_id=?").bind(b.id),
      db().prepare("UPDATE lllm_bridge_jobs SET state='failed',expires_at=? WHERE id=?").bind(Date.now() + 60_000, b.id),
    ]);
    return relayJson({ ok: true });
  }
  return relayJson({ error: "Invalid operation" }, 400);
}
