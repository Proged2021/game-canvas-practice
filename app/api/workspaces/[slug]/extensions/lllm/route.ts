import { env } from "cloudflare:workers";
import { db } from "@/lib/db";
import { lllmAccess } from "@/lib/lllm-relay";
import { LLLM_MEMBER_ACCOUNTS_SQL, LLLM_WORKSPACES_SQL } from "@/lib/lllm-workspaces";
import { JOB_TTL, MAX_PARTS, validPart, validJobId, validCiphertext, relayJson, boundedRelayBody } from "@/lib/lllm-policy";
import { validateSameOriginJson } from "@/lib/request-security";
import { browserNotFound, lllmBrowserSessionGuard, verifyLllmBrowserSession } from "@/lib/lllm-browser-authorization";
import { lllmChunkCapacityGuard } from "@/lib/lllm-capacity";

type Context = { params: Promise<{ slug: string }> };
// Recheck membership in the same SQL statement that reads or changes a job.
// An earlier HTTP authorization result must not outlive a membership removal.
const memberGuard = `?3 IN (${LLLM_MEMBER_ACCOUNTS_SQL}) AND ?2 IN (${LLLM_WORKSPACES_SQL})
  AND EXISTS (SELECT 1 FROM account_memberships m WHERE m.workspace_id=?2 AND m.account_key=?3)
  AND EXISTS (SELECT 1 FROM workspace_extensions e WHERE e.workspace_id=?2 AND e.extension_id='lllm' AND e.enabled=1)`;
const sessionGuard = lllmBrowserSessionGuard("?2", "?3", "?4", "?7");
const jobSessionGuard = "EXISTS (SELECT 1 FROM lllm_browser_job_sessions s WHERE s.job_id=?1 AND s.session_hash=?7)";
const userJob = `FROM lllm_bridge_jobs j WHERE j.id=?1 AND j.workspace_id=?2 AND j.account_key=?3 AND j.expires_at>?4 AND ${memberGuard} AND ${sessionGuard} AND ${jobSessionGuard}`;
export async function GET(request: Request, { params }: Context) {
  const auth = await lllmAccess((await params).slug);
  if (!auth.ok) return auth.response;
  const session = await verifyLllmBrowserSession(request, auth.membership.workspace_id, auth.user.accountKey);
  if (!session) return browserNotFound();
  const query = new URL(request.url).searchParams;
  if (!query.has("id")) return relayJson({ publicKey: env.LLLM_PUBLIC_KEY });
  const id = query.get("id");
  if (!validJobId(id)) return relayJson({ error: "受付が見つかりません" }, 404);
  const job = await db().prepare(`SELECT j.state,j.response_parts ${userJob}`)
    .bind(id, auth.membership.workspace_id, auth.user.accountKey, Date.now(), null, null, session.hash).first<{ state: string; response_parts: number }>();
  if (!job) return relayJson({ error: "受付が見つからないか、有効期限が切れました" }, 404);
  if (query.has("part")) {
    const part = Number(query.get("part"));
    if (job.state !== "done" || !validPart(part)) return relayJson({ error: "結果の準備中です" }, 409);
    const chunk = await db().prepare(`SELECT c.ciphertext FROM lllm_bridge_chunks c
      WHERE c.job_id=?1 AND c.direction='response' AND c.part=?5
        AND EXISTS (SELECT 1 ${userJob} AND j.state='done' AND c.part<j.response_parts)`)
      .bind(id, auth.membership.workspace_id, auth.user.accountKey, Date.now(), part, null, session.hash).first();
    return chunk ? relayJson(chunk) : relayJson({ error: "結果が見つかりません" }, 404);
  }
  return relayJson(job);
}

export async function POST(request: Request, { params }: Context) {
  if (!validateSameOriginJson(request, "lllm-relay")) return relayJson({ error: "安全確認に失敗しました" }, 403);
  const auth = await lllmAccess((await params).slug);
  if (!auth.ok) return auth.response;
  const session = await verifyLllmBrowserSession(request, auth.membership.workspace_id, auth.user.accountKey);
  if (!session) return browserNotFound();
  let b; try { b = await boundedRelayBody(request); } catch { return relayJson({ error: "通信形式またはサイズが不正です" }, 400); }
  if (b?.action === "closeSession") {
    const database = db();
    const ownedJobs = `SELECT j.id FROM lllm_bridge_jobs j JOIN lllm_browser_job_sessions s ON s.job_id=j.id
      WHERE s.session_hash=?1 AND j.workspace_id=?2 AND j.account_key=?3`;
    await database.batch([
      database.prepare(`DELETE FROM lllm_bridge_chunks WHERE job_id IN (${ownedJobs})`).bind(session.hash, auth.membership.workspace_id, auth.user.accountKey),
      database.prepare(`DELETE FROM lllm_bridge_jobs WHERE id IN (${ownedJobs})`).bind(session.hash, auth.membership.workspace_id, auth.user.accountKey),
      database.prepare("DELETE FROM lllm_browser_job_sessions WHERE session_hash=?1 AND NOT EXISTS (SELECT 1 FROM lllm_bridge_jobs j WHERE j.id=job_id)").bind(session.hash),
      database.prepare("DELETE FROM lllm_browser_authorizations WHERE token_hash=?1 AND workspace_id=?2 AND account_key=?3 AND kind='session'")
        .bind(session.hash, auth.membership.workspace_id, auth.user.accountKey),
    ]);
    return relayJson({ ok: true });
  }
  if (!validJobId(b?.id)) return relayJson({ error: "受付が不正です" }, 400);
  if (b.action === "create") {
    if (!Number.isInteger(b.parts) || b.parts < 1 || b.parts > MAX_PARTS) return relayJson({ error: "通信サイズが不正です" }, 400);
    const heartbeat = await db().prepare("SELECT last_seen FROM lllm_bridge_state WHERE id='server'").first<{ last_seen: number }>();
    if (!heartbeat || Date.now() - heartbeat.last_seen > 30_000) return relayJson({ error: "LLLMサーバーがオフラインです" }, 503);
    // A single atomic INSERT enforces both global and per-account bounds across isolates.
    const now = Date.now();
    const added = await db().batch([db().prepare(`INSERT INTO lllm_bridge_jobs(id,workspace_id,account_key,request_parts,created_at,expires_at)
      SELECT ?1,?2,?3,?4,?5,?6 WHERE ${memberGuard} AND ${lllmBrowserSessionGuard("?2", "?3", "?5", "?7")} AND
      (SELECT COUNT(*) FROM lllm_bridge_jobs WHERE expires_at>?5 AND state NOT IN ('failed'))<64 AND
      (SELECT COUNT(*) FROM lllm_bridge_jobs WHERE account_key=?3 AND expires_at>?5 AND state NOT IN ('failed'))<12
      ON CONFLICT(id) DO NOTHING`).bind(b.id, auth.membership.workspace_id, auth.user.accountKey, b.parts, now, now + JOB_TTL, session.hash),
      db().prepare(`INSERT INTO lllm_browser_job_sessions(job_id,session_hash)
        SELECT ?1,?7 FROM lllm_bridge_jobs j WHERE changes()=1 AND j.id=?1 AND j.workspace_id=?2 AND j.account_key=?3 AND j.created_at=?5
          AND ${memberGuard} AND ${lllmBrowserSessionGuard("?2", "?3", "?5", "?7")}
        ON CONFLICT(job_id) DO NOTHING`).bind(b.id, auth.membership.workspace_id, auth.user.accountKey, null, now, null, session.hash),
    ]);
    return added[0].meta.changes && added[1].meta.changes ? relayJson({ ok: true }, 201) : relayJson({ error: "受付がいっぱいか、起動の有効期限が切れました。ワークスペースで開き直してください。" }, 429);
  }
  const job = await db().prepare(`SELECT j.state,j.request_parts ${userJob}`)
    .bind(b.id, auth.membership.workspace_id, auth.user.accountKey, Date.now(), null, null, session.hash).first<{ state: string; request_parts: number }>();
  if (!job) return relayJson({ error: "受付が見つかりません" }, 404);
  if (b.action === "delete") {
    const removed = await db().batch([
      db().prepare(`DELETE FROM lllm_bridge_chunks WHERE job_id=?1 AND EXISTS (SELECT 1 ${userJob})`)
        .bind(b.id, auth.membership.workspace_id, auth.user.accountKey, Date.now(), null, null, session.hash),
      db().prepare(`DELETE FROM lllm_bridge_jobs AS j WHERE j.id=?1 AND j.workspace_id=?2 AND j.account_key=?3 AND j.expires_at>?4 AND ${memberGuard} AND ${sessionGuard} AND ${jobSessionGuard}`)
        .bind(b.id, auth.membership.workspace_id, auth.user.accountKey, Date.now(), null, null, session.hash),
      db().prepare("DELETE FROM lllm_browser_job_sessions WHERE job_id=?1 AND NOT EXISTS (SELECT 1 FROM lllm_bridge_jobs WHERE id=?1)").bind(b.id),
    ]);
    return removed[1].meta.changes ? relayJson({ok:true}) : relayJson({error:"受付が見つかりません"},404);
  }
  if (b.action === "chunk" && job.state === "uploading" && validPart(b.part) && b.part < job.request_parts && validCiphertext(b.ciphertext)) {
    const written = await db().prepare(`INSERT INTO lllm_bridge_chunks(job_id,direction,part,ciphertext)
      SELECT j.id,'request',?5,?6 ${userJob} AND j.state='uploading' AND ?5<j.request_parts
        AND ${lllmChunkCapacityGuard("?3", "?1", "request", "?5")}
      ON CONFLICT(job_id,direction,part) DO UPDATE SET ciphertext=lllm_bridge_chunks.ciphertext`)
      .bind(b.id,auth.membership.workspace_id,auth.user.accountKey,Date.now(),b.part,b.ciphertext,session.hash).run();
    if (written.meta.changes) return relayJson({ ok: true });
    const current = await db().prepare(`SELECT j.id ${userJob} AND j.state='uploading' AND ?5<j.request_parts`)
      .bind(b.id,auth.membership.workspace_id,auth.user.accountKey,Date.now(),b.part,null,session.hash).first();
    return current ? relayJson({ error: "一時保管がいっぱいです。処理中の画面を閉じるか、少し待ってから再送してください。" }, 429)
      : relayJson({error:"受付が見つからないか、利用権限が変更されました"},404);
  }
  if (b.action === "submit" && job.state === "uploading") {
    const changed = await db().prepare(`UPDATE lllm_bridge_jobs AS j SET state='ready'
      WHERE j.id=?1 AND j.workspace_id=?2 AND j.account_key=?3 AND j.expires_at>?4 AND ${memberGuard} AND ${sessionGuard} AND ${jobSessionGuard}
        AND j.state='uploading' AND (SELECT COUNT(*) FROM lllm_bridge_chunks WHERE job_id=?1 AND direction='request')=j.request_parts`)
      .bind(b.id,auth.membership.workspace_id,auth.user.accountKey,Date.now(),null,null,session.hash).run();
    return changed.meta.changes ? relayJson({ ok: true }) : relayJson({ error: "アップロードが未完了です" }, 409);
  }
  return relayJson({ error: "受付状態が変わりました" }, 409);
}
