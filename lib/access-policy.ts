export const INITIAL_ALLOWED_USER_EMAIL = "naoki.takehara111@gmail.com";
export const INITIAL_OWNER_WORKSPACE_SLUG = "workspace-06908b60-3df";

export function authorizationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isInitialAllowedUser(email: string): boolean {
  return authorizationEmail(email) === INITIAL_ALLOWED_USER_EMAIL;
}

export function maskEmail(email: string): string {
  const [local, domain] = authorizationEmail(email).split("@");
  if (!local || !domain) return "***";
  const visibleLocal =
    local.length <= 2
      ? `${local[0] ?? ""}***`
      : `${local[0]}***${local.at(-1)}`;
  return `${visibleLocal}@${domain}`;
}
