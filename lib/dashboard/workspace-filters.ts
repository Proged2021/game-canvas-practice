import type { WorkspaceSummary } from "@/lib/db";

export type WorkspaceOrder = "updated" | "name";

export function filterAndSortWorkspaces(items: WorkspaceSummary[], query: string, order: WorkspaceOrder) {
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ja");
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const result = items.filter((item) => words.every((word) => normalize(`${item.name} ${item.slug}`).includes(word)));
  if (order === "name") {
    const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
    result.sort((left, right) => collator.compare(left.name, right.name) || left.slug.localeCompare(right.slug));
  }
  // The server supplies workspace summaries in descending update order.
  return result;
}
