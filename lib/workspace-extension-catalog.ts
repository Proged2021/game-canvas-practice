/** Public, ready-made catalog. Workspace registrations are never published here. */
export const WORKSPACE_EXTENSION_CATALOG = [] as const;

/** Existing application-owned integration; its original access rules still apply. */
export const WORKSPACE_INTEGRATED_EXTENSIONS = [{
  id: "lllm",
  name: "LLLM / AI STUDIO",
  description: "文章チャット・画像生成・画像編集",
  features: ["文章チャット", "画像生成", "画像編集"],
}] as const;
