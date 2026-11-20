export const LLLM_WORKSPACE_ID = "0279e5f9-6122-4fb9-90ff-b9073a9fc7c1";
export const CHUNK_SIZE = 180_000;
export const MAX_PARTS = 360;
export const JOB_TTL = 20 * 60 * 1000;
export const validJobId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);
export const validPart = (p: unknown): p is number => Number.isInteger(p) && Number(p) >= 0 && Number(p) < MAX_PARTS;
export const validCiphertext = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= CHUNK_SIZE && /^[A-Za-z0-9+/=]+$/.test(s);
export const privateHeaders = {
  "cache-control": "private, no-store, no-cache, max-age=0, must-revalidate",
  pragma: "no-cache", expires: "0", "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff", "x-frame-options": "DENY",
};
export const relayJson = (body: unknown, status = 200) => Response.json(body, { status, headers: privateHeaders });

export async function boundedRelayBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const decoder = new TextDecoder();
  let length = 0, text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 181_000) throw new Error("Too large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); }
}
