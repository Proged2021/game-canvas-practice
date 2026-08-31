export const CONFLUENCE_ASSET_CHUNK_BYTES = 256 * 1024;

export function chunkAssetBytes(bytes: ArrayBuffer, size = CONFLUENCE_ASSET_CHUNK_BYTES) {
  const input = new Uint8Array(bytes);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < input.byteLength; offset += size)
    chunks.push(input.slice(offset, Math.min(input.byteLength, offset + size)));
  return chunks;
}

export function joinAssetChunks(chunks: Array<Uint8Array | ArrayBuffer | number[]>) {
  const values = chunks.map((chunk) => chunk instanceof Uint8Array
    ? chunk
    : chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : Uint8Array.from(chunk));
  const total = values.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of values) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export function createStoredAssetResponse(
  mime: string,
  byteSize: number,
  chunks: Array<Uint8Array | ArrayBuffer | number[]>,
) {
  const bytes = joinAssetChunks(chunks);
  if (bytes.byteLength !== byteSize)
    return Response.json({ error: "保存画像を復元できませんでした" }, { status: 500 });
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": mime,
      "content-length": String(bytes.byteLength),
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
