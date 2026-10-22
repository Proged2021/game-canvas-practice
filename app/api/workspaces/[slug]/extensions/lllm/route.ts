import { env } from "cloudflare:workers";
import { db } from "@/lib/db";
import { lllmAccess, deleteRelayJob } from "@/lib/lllm-relay";
import { JOB_TTL, MAX_PARTS, validPart, validJobId, validCiphertext, relayJson, boundedRelayBody } from "@/lib/lllm-policy";
import { validateSameOriginJson } from "@/lib/request-security";

type Context = { params: Promise<{ slug: string }> };
export async function GET(request: Request, { params }: Context) {
  const auth = await lllmAccess((await params).slug);
  if (!auth.ok) return auth.response;
  const query = new URL(request.url).searchParams;
  if (!query.has("id")) return relayJson({ publicKey: env.LLLM_PUBLIC_KEY });
  const id = query.get("id");
  if (!validJobId(id)) return relayJson({ error: "受付が見つかりません" }, 404);
  const job = await db().prepare("SELECT state,response_parts FROM lllm_bridge_jobs WHERE id=? AND workspace_id=? AND account_key=? AND expires_at>?")
    .bind(id, auth.membership.workspace_id, auth.user.accountKey, Date.now()).first<{ state: string; response_parts: number }>();
  if (!job) return relayJson({ error: "受付が見つからないか、有効期限が切れました" }, 404);
  if (query.has("part")) {
    const part = Number(query.get("part"));
    if (job.state !== "done" || !validPart(part)) return relayJson({ error: "結果の準備中です" }, 409);
    const chunk = await db().prepare("SELECT ciphertext FROM lllm_bridge_chunks WHERE job_id=? AND direction='response' AND part=?").bind(id, part).first();
    return chunk ? relayJson(chunk) : relayJson({ error: "結果が見つかりません" }, 404);
  }
  return relayJson(job);
}

export async function POST(request: Request, { params }: Context) {
  if (!validateSameOriginJson(request, "lllm-relay")) return relayJson({ error: "安全確認に失敗しました" }, 403);
  const auth = await lllmAccess((await params).slug);
  if (!auth.ok) return auth.response;
  let b; try { b = await boundedRelayBody(request); } catch { return relayJson({ error: "通信形式またはサイズが不正です" }, 400); }
  if (!validJobId(b?.id)) return relayJson({ error: "受付が不正です" }, 400);
  if (b.action === "create") {
    if (!Number.isInteger(b.parts) || b.parts < 1 || b.parts > MAX_PARTS) return relayJson({ error: "通信サイズが不正です" }, 400);
    const heartbeat = await db().prepare("SELECT last_seen FROM lllm_bridge_state WHERE id='server'").first<{ last_seen: number }>();
    if (!heartbeat || Date.now() - heartbeat.last_seen > 30_000) return relayJson({ error: "LLLMサーバーがオフラインです" }, 503);
    // A single atomic INSERT enforces both global and per-account bounds across isolates.
    const added = await db().prepare(`INSERT INTO lllm_bridge_jobs(id,workspace_id,account_key,request_parts,created_at,expires_at)
      SELECT ?1,?2,?3,?4,?5,?6 WHERE
      (SELECT COUNT(*) FROM lllm_bridge_jobs WHERE expires_at>?5 AND state NOT IN ('failed'))<64 AND
      (SELECT COUNT(*) FROM lllm_bridge_jobs WHERE account_key=?3 AND expires_at>?5 AND state NOT IN ('failed'))<12
      ON CONFLICT(id) DO NOTHING`).bind(b.id, auth.membership.workspace_id, auth.user.accountKey, b.parts, Date.now(), Date.now() + JOB_TTL).run();
    return added.meta.changes ? relayJson({ ok: true }, 201) : relayJson({ error: "受付がいっぱいです。少し待ってください" }, 429);
  }
  const job = await db().prepare("SELECT state,request_parts FROM lllm_bridge_jobs WHERE id=? AND workspace_id=? AND account_key=? AND expires_at>?")
    .bind(b.id, auth.membership.workspace_id, auth.user.accountKey, Date.now()).first<{ state: string; request_parts: number }>();
  if (!job) return relayJson({ error: "受付が見つかりません" }, 404);
  if (b.action === "delete") { await deleteRelayJob(b.id); return relayJson({ ok: true }); }
  if (b.action === "chunk" && job.state === "uploading" && validPart(b.part) && b.part < job.request_parts && validCiphertext(b.ciphertext)) {
    await db().prepare("INSERT INTO lllm_bridge_chunks(job_id,direction,part,ciphertext) VALUES (?,'request',?,?) ON CONFLICT(job_id,direction,part) DO NOTHING").bind(b.id, b.part, b.ciphertext).run();
    return relayJson({ ok: true });
  }
  if (b.action === "submit" && job.state === "uploading") {
    const changed = await db().prepare("UPDATE lllm_bridge_jobs SET state='ready' WHERE id=? AND state='uploading' AND (SELECT COUNT(*) FROM lllm_bridge_chunks WHERE job_id=? AND direction='request')=request_parts")
      .bind(b.id, b.id).run();
    return changed.meta.changes ? relayJson({ ok: true }) : relayJson({ error: "アップロードが未完了です" }, 409);
  }
  return relayJson({ error: "受付状態が変わりました" }, 409);
}
