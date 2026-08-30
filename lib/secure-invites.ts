export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64Url(bytes);
}

export function randomConfirmationCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const value = new DataView(bytes.buffer).getUint32(0) % 1_000_000;
  return value.toString().padStart(6, "0");
}

function toBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function hashInviteToken(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toBase64Url(new Uint8Array(digest));
}
