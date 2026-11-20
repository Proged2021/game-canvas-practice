import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkspaceOrder } from "@/lib/dashboard/workspace-filters";

export function WorkspaceFilters({ count, visibleCount, query, setQuery, order, setOrder, clearSearch }: {
  count: number; visibleCount: number; query: string; setQuery(value: string): void;
  order: WorkspaceOrder; setOrder(value: WorkspaceOrder): void; clearSearch(): void;
}) {
  if (!count && !query) return null;
  return <section className="workspace-filters mb-5 grid gap-3" aria-label="ワークスペースを探す">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="grid flex-1 gap-2">
        <label htmlFor="workspace-search" className="text-sm">参加中のワークスペースを探す</label>
        <p id="workspace-search-scope" className="text-xs text-[#77746c]">参加中のワークスペースを、名前やURLの一部で検索できます。</p>
        <div className="flex items-center gap-2"><Search size={17} aria-hidden="true" />
          <Input id="workspace-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="名前やURLの一部で検索" autoComplete="off" aria-describedby="workspace-search-scope workspace-results-count" />
          {query && <Button type="button" variant="ghost" size="sm" onClick={clearSearch} aria-label="ワークスペースの検索を解除"><X size={15} /></Button>}
        </div>
      </div>
      <div className="grid gap-2"><label htmlFor="workspace-sort" className="text-sm">表示順</label>
        <Select value={order} onValueChange={(value) => setOrder(value === "name" ? "name" : "updated")}>
          <SelectTrigger id="workspace-sort"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="updated">更新順</SelectItem><SelectItem value="name">名前順</SelectItem></SelectContent>
        </Select>
      </div>
    </div>
    <p id="workspace-results-count" role="status" className="text-sm text-muted-foreground">{count}件中{visibleCount}件{query.trim() ? "が一致" : "を表示"}</p>
  </section>;
}
