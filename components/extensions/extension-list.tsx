import { ArrowRight, Folder, Plus, Puzzle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExtensionCard } from "./extension-card";
import { groupName } from "./display";
import type { ExtensionManager } from "./use-workspace-extensions";

export function ExtensionList({ manager }: { manager: ExtensionManager }) {
  const {
    tabId, tab, manage, loading, saving, items, installed, filtered, query, setQuery,
    activeGroup, setGroup, filterGroups, visible, sections, switchTab, openForm,
  } = manager;

  return (
    <div id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${tab}`} className="extension-tab-panel">
      {tab === "catalog" ? (
        <div className="extension-empty">
          <Puzzle size={30} />
          <h3>用意された拡張機能は、まだありません</h3>
          <p>公開カタログに追加された機能を、ここから選べるようになります。<br />自分で作ったアプリは「自作・連携」から追加できます。</p>
          {manage && (
            <Button variant="outline" onClick={() => switchTab("custom")}>自作・連携を見る<ArrowRight size={14} /></Button>
          )}
        </div>
      ) : (
        <>
          {tab === "custom" && (
            <div className="extension-add-intro">
              <div>
                <h3>自分のアプリを、この場所に</h3>
                <p>名前・アプリのURL・グループを登録します。一覧に出るのは、このワークスペースのメンバーだけです。</p>
              </div>
              {manage && (
                <Button className="extension-primary-action" disabled={loading || saving} onClick={() => openForm()}>
                  <Plus size={15} />自作拡張機能を追加
                </Button>
              )}
            </div>
          )}

          {(items.length > 0 || filtered) && (
            <div className="extension-filter-bar">
              <label className="extension-search">
                <Search size={15} />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・説明・グループで探す" aria-label="このワークスペースの拡張機能を探す" />
              </label>
              <label className="extension-group-filter">
                <span>グループ</span>
                <select aria-label="拡張機能のグループ" value={activeGroup} onChange={(event) => setGroup(event.target.value)}>
                  <option value="">すべて</option>
                  {filterGroups.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            </div>
          )}

          {!loading && visible.length === 0 && (
            <div className="extension-empty">
              <Folder size={27} />
              <h3>{filtered ? "条件に合う拡張機能がありません" : tab === "installed" ? "まだ追加されていません" : "このワークスペースの自作機能は、まだありません"}</h3>
              <p>{filtered ? "このワークスペースに登録された機能だけを検索しています。" : manage ? "用意された機能を選ぶか、自分のアプリを追加して始められます。" : "使いたい機能がある場合は、オーナーに追加を依頼してください。"}</p>
              {filtered ? (
                <Button variant="outline" onClick={() => { setQuery(""); setGroup(""); }}>検索条件をクリア</Button>
              ) : tab === "installed" && (
                <Button variant="outline" onClick={() => switchTab("custom")}>拡張機能を追加する<ArrowRight size={14} /></Button>
              )}
            </div>
          )}

          {sections.map((name) => (
            <section className="extension-group-section" key={name} aria-label={`${name}の拡張機能`}>
              <div className="extension-group-heading">
                <Folder size={15} /><h3>{name}</h3>
                <span>{visible.filter((extension) => groupName(extension) === name).length}件</span>
              </div>
              <div className="extension-card-grid">
                {visible.filter((extension) => groupName(extension) === name).map((extension) => (
                  <ExtensionCard key={extension.id} extension={extension} manager={manager} />
                ))}
              </div>
            </section>
          ))}
          {tab === "installed" && manage && installed.length > 0 && (
            <Button variant="outline" className="extension-add-more" onClick={() => switchTab("custom")}>
              <Plus size={15} />ほかの拡張機能を追加
            </Button>
          )}
        </>
      )}
    </div>
  );
}
