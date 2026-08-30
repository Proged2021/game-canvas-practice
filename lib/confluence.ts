import { env } from "cloudflare:workers";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
export { atlassianError, extractPageId, parseConfluencePage, sanitizeConfluenceHtml } from "@/lib/confluence-safe";

export const CONFLUENCE_CALLBACK_URL = "https://game-design-workspace.naoki-takehara111.chatgpt.site/api/confluence/callback";
export const CONFLUENCE_SCOPES = "read:page:confluence offline_access";
export type ConfluencePublicState = "unconfigured" | "available" | "connected" | "reauth_required";

type Connection = {
  workspace_id: string; cloud_id: string; cloud_url: string;
  access_token_ciphertext: string; refresh_token_ciphertext: string | null;
  token_expires_at: string | null; page_id: string | null; page_version: number | null;
};

export function confluenceConfiguration() {
  const clientId = env.ATLASSIAN_CLIENT_ID as string | undefined;
  const clientSecret = env.ATLASSIAN_CLIENT_SECRET as string | undefined;
  const encryptionKey = env.TOKEN_ENCRYPTION_KEY as string | undefined;
  return {
    configured: Boolean(clientId && clientSecret && encryptionKey),
    clientId,
    clientSecret,
    encryptionReady: Boolean(encryptionKey),
    redirectUri: CONFLUENCE_CALLBACK_URL,
  };
}

export function publicConfluenceStatus(connected = false, reauthRequired = false) {
  const config = confluenceConfiguration();
  const state: ConfluencePublicState = !config.configured
    ? "unconfigured"
    : reauthRequired
      ? "reauth_required"
      : connected
        ? "connected"
        : "available";
  return {
    state,
    configured: config.configured,
    connected,
    callbackUrl: CONFLUENCE_CALLBACK_URL,
    requiredSecrets: ["ATLASSIAN_CLIENT_ID", "ATLASSIAN_CLIENT_SECRET"],
    tokenEncryptionConfigured: config.encryptionReady,
  };
}

export function oauthConfig() {
  const config = confluenceConfiguration();
  if (!config.configured || !config.clientId || !config.clientSecret) throw new Error("Confluence連携は未設定です");
  return { clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri };
}

export async function exchangeCode(code: string) {
  const config = oauthConfig();
  const response = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: config.redirectUri }),
  });
  if (!response.ok) throw new Error("Atlassian認証を完了できませんでした");
  return response.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>;
}

async function refresh(connection: Connection) {
  if (!connection.refresh_token_ciphertext) throw new Error("Confluenceの再認証が必要です");
  const { clientId, clientSecret } = oauthConfig();
  const response = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: await decrypt(connection.refresh_token_ciphertext) }),
  });
  if (!response.ok) throw new Error("Confluenceの再認証が必要です");
  const token = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
  await db().prepare("UPDATE confluence_connections SET access_token_ciphertext=?1, refresh_token_ciphertext=?2, token_expires_at=?3 WHERE workspace_id=?4")
    .bind(await encrypt(token.access_token), token.refresh_token ? await encrypt(token.refresh_token) : connection.refresh_token_ciphertext, expiresAt, connection.workspace_id).run();
  return token.access_token;
}

export async function accessToken(connection: Connection) {
  if (connection.token_expires_at && Date.parse(connection.token_expires_at) < Date.now() + 60_000) return refresh(connection);
  return decrypt(connection.access_token_ciphertext);
}

export async function getConnection(workspaceId: string) {
  return db().prepare("SELECT * FROM confluence_connections WHERE workspace_id=?1").bind(workspaceId).first<Connection>();
}

export async function getConfluenceConnectionState(workspaceId: string) {
  const row = await db().prepare("SELECT CASE WHEN access_token_ciphertext IS NOT NULL THEN 1 ELSE 0 END AS connected, last_error FROM confluence_connections WHERE workspace_id=?1")
    .bind(workspaceId).first<{ connected: number; last_error: string | null }>();
  return {
    connected: Boolean(row?.connected),
    reauthRequired: Boolean(row?.last_error?.includes("再認証")),
  };
}
