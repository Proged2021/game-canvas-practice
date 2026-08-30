export type OAuthStateRecord = {
  workspace_id: string;
  user_email: string;
  scene_id?: string | null;
  expires_at: string;
};

export type OAuthWorkspace = {
  slug: string;
};

export type OAuthStateResult =
  | "ok"
  | "state-invalid"
  | "state-expired"
  | "owner-mismatch";

export function validateOAuthStateContext(
  record: OAuthStateRecord | null,
  workspace: OAuthWorkspace | null,
  currentAccountKey: string | null,
  membershipRole: string | null,
  now = Date.now(),
): OAuthStateResult {
  if (!record || !workspace) return "state-invalid";
  if (!Number.isFinite(Date.parse(record.expires_at)) || Date.parse(record.expires_at) <= now)
    return "state-expired";
  if (
    !currentAccountKey ||
    record.user_email !== currentAccountKey ||
    membershipRole !== "owner"
  )
    return "owner-mismatch";
  return "ok";
}
