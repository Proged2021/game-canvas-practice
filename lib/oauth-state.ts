export type OAuthStateRecord = {
  workspace_id: string;
  user_email: string;
  expires_at: string;
};

export type OAuthWorkspace = {
  slug: string;
  owner_email: string;
};

export type OAuthStateResult =
  | "ok"
  | "state-invalid"
  | "state-expired"
  | "owner-mismatch";

export function validateOAuthStateContext(
  record: OAuthStateRecord | null,
  workspace: OAuthWorkspace | null,
  currentUserEmail: string | null,
  membershipRole: string | null,
  now = Date.now(),
): OAuthStateResult {
  if (!record || !workspace) return "state-invalid";
  if (!Number.isFinite(Date.parse(record.expires_at)) || Date.parse(record.expires_at) <= now)
    return "state-expired";
  if (
    !currentUserEmail ||
    record.user_email.toLowerCase() !== currentUserEmail.toLowerCase() ||
    workspace.owner_email.toLowerCase() !== currentUserEmail.toLowerCase() ||
    membershipRole !== "owner"
  )
    return "owner-mismatch";
  return "ok";
}
