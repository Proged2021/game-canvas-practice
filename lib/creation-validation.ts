export const normalizeSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

export const createAutomaticSlug = () =>
  `workspace-${crypto.randomUUID().slice(0, 12)}`;

export function validateWorkspaceCreation(body: {
  name?: string;
  slug?: string;
}) {
  const name = body.name?.trim() ?? "";
  if (!name) return { error: "ワークスペース名を入力してください" } as const;
  if (name.length > 80)
    return {
      error: "ワークスペース名は80文字以内で入力してください",
    } as const;

  const requestedSlug = body.slug?.trim() ?? "";
  const slug = requestedSlug
    ? normalizeSlug(requestedSlug)
    : createAutomaticSlug();
  if (
    requestedSlug &&
    (slug !== requestedSlug.toLowerCase() || slug.length < 3)
  ) {
    return {
      error: "スラッグは半角英小文字・数字・ハイフンで3〜64文字にしてください",
    } as const;
  }
  return { value: { name, slug } } as const;
}

export function validateSceneCreation(body: {
  title?: string;
  confluencePageUrl?: string;
}) {
  const title = body.title?.trim() ?? "";
  if (!title) return { error: "場面タイトルを入力してください" } as const;
  if (title.length > 120)
    return { error: "場面タイトルは120文字以内で入力してください" } as const;

  const confluencePageUrl = body.confluencePageUrl?.trim() || null;
  if (confluencePageUrl) {
    try {
      const parsed = new URL(confluencePageUrl);
      if (parsed.protocol !== "https:") throw new Error();
    } catch {
      return {
        error:
          "ConfluenceページURLは https:// から始まる有効なURLを入力してください",
      } as const;
    }
  }
  return { value: { title, confluencePageUrl } } as const;
}
