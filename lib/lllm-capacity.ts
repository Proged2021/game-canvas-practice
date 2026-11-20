// Each encrypted chunk is bounded by CHUNK_SIZE. Count slots instead of scanning
// ciphertext on every upload: at most ~184 MB globally and ~115 MB per account.
export const MAX_RELAY_CHUNKS = 1024;
export const MAX_ACCOUNT_RELAY_CHUNKS = 640;

export function lllmChunkCapacityGuard(account: string, job: string, direction: "request" | "response", part: string) {
  // Retrying an immutable existing part must still succeed when the store is full.
  return `(EXISTS (SELECT 1 FROM lllm_bridge_chunks capacity_existing
      WHERE capacity_existing.job_id=${job} AND capacity_existing.direction='${direction}' AND capacity_existing.part=${part})
    OR ((SELECT COUNT(*) FROM lllm_bridge_chunks)<${MAX_RELAY_CHUNKS}
      AND (SELECT COUNT(*) FROM lllm_bridge_chunks capacity_chunk
        JOIN lllm_bridge_jobs capacity_job ON capacity_job.id=capacity_chunk.job_id
        WHERE capacity_job.account_key=${account})<${MAX_ACCOUNT_RELAY_CHUNKS}))`;
}
