import { env } from "cloudflare:workers";
import sanitizeHtml from "sanitize-html";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

type Connection = {
  workspace_id: string; cloud_id: string; cloud_url: string;
  access_token_ciphertext: string; refresh_token_ciphertext: string | null;
  token_expires_at: string | null; page_id: string | null; page_version: number | null;
};

export function oauthConfig(origin: string) {
  const clientId = env.ATLASSIAN_CLIENT_ID as string | undefined;
  const clientSecret = env.ATLASSIAN_CLIENT_SECRET as string | undefined;
  if (!clientId || !clientSecret) throw new Error("Atlassian OAuth設定が未登録です");
  return { clientId, clientSecret, redirectUri: `${origin}/api/confluence/callback` };
}

export async function exchangeCode(code: string, origin: string) {
  const config = oauthConfig(origin);
  const response = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: config.redirectUri }),
  });
  if (!response.ok) throw new Error(`Atlassian token exchange failed (${response.status})`);
  return response.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>;
}

async function refresh(connection: Connection) {
  if (!connection.refresh_token_ciphertext) throw new Error("Confluenceの再接続が必要です");
  const clientId = env.ATLASSIAN_CLIENT_ID as string;
  const clientSecret = env.ATLASSIAN_CLIENT_SECRET as string;
  const response = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: await decrypt(connection.refresh_token_ciphertext) }),
  });
  if (!response.ok) throw new Error(`Atlassian token refresh failed (${response.status})`);
  const token = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
  const accessCipher = await encrypt(token.access_token);
  const refreshCipher = token.refresh_token ? await encrypt(token.refresh_token) : connection.refresh_token_ciphertext;
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
  await db().prepare("UPDATE confluence_connections SET access_token_ciphertext=?1, refresh_token_ciphertext=?2, token_expires_at=?3 WHERE workspace_id=?4")
    .bind(accessCipher, refreshCipher, expiresAt, connection.workspace_id).run();
  return token.access_token;
}

export async function accessToken(connection: Connection) {
  if (connection.token_expires_at && Date.parse(connection.token_expires_at) < Date.now() + 60_000) return refresh(connection);
  return decrypt(connection.access_token_ciphertext);
}

export function extractPageId(input: string) {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/pages\/(\d+)/) ?? url.search.match(/[?&]pageId=(\d+)/);
    return match?.[1] ?? null;
  } catch { return null; }
}

function absolute(value: string, base: string) {
  try { return new URL(value, base).toString(); } catch { return value; }
}

export function sanitizeConfluenceHtml(html: string, baseUrl: string) {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "figure", "figcaption", "details", "summary", "time", "mark"]),
    allowedAttributes: {
      "*": ["class", "title", "style", "data-layout", "data-local-id"],
      a: ["href", "name", "target", "rel", "class", "title"],
      img: ["src", "alt", "title", "width", "height", "class", "loading"],
      td: ["colspan", "rowspan", "style"], th: ["colspan", "rowspan", "style"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedStyles: { "*": { color: [/^#[0-9a-f]{3,8}$/i, /^rgb/], "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgb/], "text-align": [/^left$|^right$|^center$/], "font-weight": [/^\d+$|^bold$/], "text-decoration": [/^underline$|^line-through$/], width: [/^\d+(px|%)$/], height: [/^\d+(px|%)$/] } },
    transformTags: {
      a: (_tag, attrs) => ({ tagName: "a", attribs: { ...attrs, href: absolute(attrs.href ?? "", baseUrl), target: "_blank", rel: "noopener noreferrer" } }),
      img: (_tag, attrs) => ({ tagName: "img", attribs: { ...attrs, src: absolute(attrs.src ?? "", baseUrl), loading: "lazy" } }),
    },
  });
}

export async function getConnection(workspaceId: string) {
  return db().prepare("SELECT * FROM confluence_connections WHERE workspace_id=?1").bind(workspaceId).first<Connection>();
}
