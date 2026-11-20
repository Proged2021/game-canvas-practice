export const MAX_WORKSPACE_CUSTOM_EXTENSIONS = 100;
export const CUSTOM_EXTENSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const CUSTOM_EXTENSION_DEFAULT_GROUP = "未分類";
const controls = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

export type CustomExtensionInput = { name: string; description: string; url: string; group: string };
export type CustomExtensionRow = { id: string; workspace_id: string; name: string; description: string; url: string;
  group_name: string; enabled: number; revision: number; created_at: string; updated_at: string };
type ExtensionScope = { workspaceId: string; accountKey: string; slug: string; workspaceName: string };
type Failure = { ok: false; status: number; error: string };
const ownerDenied = (): Failure => ({ ok: false, status: 403, error: "管理できるのは現在のワークスペースのオーナーだけです。画面を更新してください。" });
const missing = (): Failure => ({ ok: false, status: 404, error: "このワークスペースの拡張機能が見つかりません。" });
const columns = "e.id,e.workspace_id,e.name,e.description,e.url,e.group_name,e.enabled,e.revision,e.created_at,e.updated_at";

export function validateCustomExtensionUrl(value: unknown): { url: string } | { error: string } {
  if (typeof value !== "string" || controls.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value))
    return { error: "URLに制御文字は使えません。HTTPSのURLを入力してください。" };
  const source = value.trim();
  if (!source || source.length > 2048 || !/^https:\/\//i.test(source) || /[\\\s]/.test(source))
    return { error: "2048文字以内のHTTPSのURLを入力してください。" };
  try {
    const url = new URL(source);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || source.slice(8).split(/[/?#]/, 1)[0].includes("@"))
      return { error: "ユーザー名・パスワードを含まないHTTPSのURLを入力してください。" };
    if (url.href.length > 2048) return { error: "URLは2048文字以内で入力してください。" };
    return { url: url.href };
  } catch { return { error: "正しいHTTPSのURLを入力してください。" }; }
}

export function validateCustomExtensionInput(body: { name?: unknown; description?: unknown; url?: unknown; group?: unknown }):
  { value: CustomExtensionInput } | { error: string } {
  if (typeof body.name !== "string" || controls.test(body.name)) return { error: "拡張機能の名前を入力してください。" };
  const name = body.name.trim().normalize("NFC");
  if (!name || name.length > 80) return { error: "名前は1〜80文字で入力してください。" };
  if (body.description !== undefined && typeof body.description !== "string") return { error: "説明は500文字以内で入力してください。" };
  const description = (typeof body.description === "string" ? body.description : "").replace(/\r\n?/g, "\n").trim().normalize("NFC");
  if (description.length > 500 || controls.test(description.replace(/[\n\t]/g, ""))) return { error: "説明は制御文字を含めず、500文字以内で入力してください。" };
  if (body.group !== undefined && (typeof body.group !== "string" || controls.test(body.group))) return { error: "グループ名は40文字以内で入力してください。" };
  const group = (typeof body.group === "string" ? body.group : "").trim().normalize("NFC") || CUSTOM_EXTENSION_DEFAULT_GROUP;
  if (group.length > 40) return { error: "グループ名は40文字以内で入力してください。" };
  const checked = validateCustomExtensionUrl(body.url);
  if ("error" in checked) return checked;
  return { value: { name, description, group, url: checked.url } };
}

export function customExtensionView(row: CustomExtensionRow, scope: Pick<ExtensionScope, "slug" | "workspaceName">) {
  return { id: row.id, kind: "custom" as const, visibility: "workspace" as const, group: row.group_name,
    name: row.name, description: row.description, url: row.url, features: [] as string[], workspaceName: scope.workspaceName,
    installed: true, available: true, enabled: row.enabled === 1, configured: true, online: null,
    href: `/w/${encodeURIComponent(scope.slug)}/extensions/custom/${encodeURIComponent(row.id)}/open`,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function listWorkspaceCustomExtensions(database: D1Database, scope: ExtensionScope) {
  const result = await database.prepare(`SELECT ${columns} FROM workspace_custom_extensions e
    WHERE e.workspace_id=?1 AND EXISTS (SELECT 1 FROM account_memberships m WHERE m.workspace_id=e.workspace_id AND m.account_key=?2)
    ORDER BY e.group_name COLLATE NOCASE,e.name COLLATE NOCASE,e.id LIMIT ${MAX_WORKSPACE_CUSTOM_EXTENSIONS}`)
    .bind(scope.workspaceId, scope.accountKey).all<CustomExtensionRow>();
  return result.results.map(row => customExtensionView(row, scope));
}

export async function getWorkspaceCustomExtension(database: D1Database, scope: ExtensionScope, id: string, enabledOnly = false) {
  return database.prepare(`SELECT ${columns} FROM workspace_custom_extensions e
    WHERE e.workspace_id=?1 AND e.id=?2 ${enabledOnly ? "AND e.enabled=1" : ""}
      AND EXISTS (SELECT 1 FROM account_memberships m WHERE m.workspace_id=e.workspace_id AND m.account_key=?3)`)
    .bind(scope.workspaceId, id, scope.accountKey).first<CustomExtensionRow>();
}

async function isOwner(database: D1Database, scope: ExtensionScope) {
  return !!await database.prepare("SELECT 1 AS allowed FROM account_memberships WHERE workspace_id=?1 AND account_key=?2 AND role='owner'")
    .bind(scope.workspaceId, scope.accountKey).first();
}

export async function createWorkspaceCustomExtension(database: D1Database, scope: ExtensionScope, input: CustomExtensionInput) {
  const id = crypto.randomUUID();
  const result = await database.prepare(`INSERT INTO workspace_custom_extensions (id,workspace_id,name,description,url,group_name)
    SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS (SELECT 1 FROM account_memberships WHERE workspace_id=?2 AND account_key=?7 AND role='owner')
      AND (SELECT COUNT(*) FROM workspace_custom_extensions WHERE workspace_id=?2)<${MAX_WORKSPACE_CUSTOM_EXTENSIONS}`)
    .bind(id, scope.workspaceId, input.name, input.description, input.url, input.group, scope.accountKey).run();
  if (!result.meta.changes) {
    if (!await isOwner(database, scope)) return ownerDenied();
    return { ok: false, status: 409, error: `このワークスペースには自作拡張機能を${MAX_WORKSPACE_CUSTOM_EXTENSIONS}件まで登録できます。不要なものを外してから追加してください。` } as const;
  }
  const row = await getWorkspaceCustomExtension(database, scope, id);
  return row ? { ok: true, extension: customExtensionView(row, scope) } as const : ownerDenied();
}

export async function updateWorkspaceCustomExtension(database: D1Database, scope: ExtensionScope, id: string,
  change: { enabled: boolean } | CustomExtensionInput, baseRevision?: number) {
  const guard = `workspace_id=?1 AND id=?2
    AND EXISTS (SELECT 1 FROM account_memberships WHERE workspace_id=?1 AND account_key=?3 AND role='owner')
    ${baseRevision === undefined ? "" : "AND revision=?4"}`;
  const parameters: Array<string | number> = [scope.workspaceId, id, scope.accountKey];
  if (baseRevision !== undefined) parameters.push(baseRevision);
  const start = parameters.length + 1;
  const assignments = "enabled" in change ? `enabled=?${start}` : `name=?${start},description=?${start + 1},url=?${start + 2},group_name=?${start + 3}`;
  parameters.push(...("enabled" in change ? [Number(change.enabled)] : [change.name, change.description, change.url, change.group]));
  const result = await database.prepare(`UPDATE workspace_custom_extensions SET ${assignments},revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE ${guard}`)
    .bind(...parameters).run();
  if (!result.meta.changes) {
    if (!await isOwner(database, scope)) return ownerDenied();
    if (!await getWorkspaceCustomExtension(database, scope, id)) return missing();
    return { ok: false, status: 409, error: "拡張機能の設定が更新されています。一覧を更新してから、もう一度お試しください。" } as const;
  }
  const row = await getWorkspaceCustomExtension(database, scope, id);
  return row ? { ok: true, extension: customExtensionView(row, scope) } as const : ownerDenied();
}

export async function removeWorkspaceCustomExtension(database: D1Database, scope: ExtensionScope, id: string) {
  const result = await database.prepare(`DELETE FROM workspace_custom_extensions WHERE workspace_id=?1 AND id=?2
    AND EXISTS (SELECT 1 FROM account_memberships WHERE workspace_id=?1 AND account_key=?3 AND role='owner')`)
    .bind(scope.workspaceId, id, scope.accountKey).run();
  if (!result.meta.changes) return await isOwner(database, scope) ? missing() : ownerDenied();
  return { ok: true } as const;
}
