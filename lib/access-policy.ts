export const INITIAL_ALLOWED_USER_EMAIL = "naoki.takehara111@gmail.com";
export const INITIAL_ALLOWED_ACCOUNT_USER_ID =
  "302f0402-006f-44e8-948b-6313522b7d87";

export function authorizationEmail(
  email: string,
  userId: string | null = null,
): string {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedUserId = userId?.trim().toLowerCase() ?? null;
  return normalizedUserId === INITIAL_ALLOWED_ACCOUNT_USER_ID
    ? INITIAL_ALLOWED_USER_EMAIL
    : normalizedEmail;
}

export function isInitialAllowedUser(
  email: string,
  userId: string | null = null,
): boolean {
  return authorizationEmail(email, userId) === INITIAL_ALLOWED_USER_EMAIL;
}
