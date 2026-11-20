import type { Draft, Extension, Tab } from "./types";

export const tabs: Tab[] = ["installed", "catalog", "custom"];
export const actionNames = {
  add: "追加する",
  resume: "利用を再開",
  pause: "利用を停止",
  remove: "ワークスペースから外す",
};
export const emptyDraft = (): Draft => ({ name: "", description: "", url: "", group: "" });
export const displayName = (extension: Extension) => extension.id === "lllm" ? "AI STUDIO" : extension.name;
export const groupName = (extension: Extension) => extension.group || "未分類";
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ja");

export function matches(extension: Extension, query: string) {
  const text = normalize(`${displayName(extension)} ${extension.description} ${groupName(extension)}`);
  return normalize(query).trim().split(/\s+/).filter(Boolean).every((word) => text.includes(word));
}

export function appLocation(value?: string) {
  try {
    const url = new URL(value ?? "");
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return "外部アプリ";
  }
}
