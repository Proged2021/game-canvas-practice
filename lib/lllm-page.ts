import { LLLM_HTML } from "@/lib/lllm-html";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function lllmPage(slug: string, name: string) {
  return LLLM_HTML.replaceAll("__LLLM_WORKSPACE__", () => encodeURIComponent(slug))
    .replaceAll("__LLLM_NAME__", () => escapeHtml(name));
}
