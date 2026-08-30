export const INITIAL_ALLOWED_USER_EMAIL = "naoki.takehara111@gmail.com";

export function isInitialAllowedUser(email: string): boolean {
  return email.trim().toLowerCase() === INITIAL_ALLOWED_USER_EMAIL;
}
