import { env } from "cloudflare:workers";

async function key() {
  const secret = env.TOKEN_ENCRYPTION_KEY as string | undefined;
  if (!secret || secret.length < 32) throw new Error("TOKEN_ENCRYPTION_KEY must be configured with at least 32 characters");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(value));
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(bytes)))}`;
}

export async function decrypt(value: string) {
  const [ivPart, dataPart] = value.split(".");
  const iv = Uint8Array.from(atob(ivPart), c => c.charCodeAt(0));
  const data = Uint8Array.from(atob(dataPart), c => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await key(), data);
  return new TextDecoder().decode(plain);
}
