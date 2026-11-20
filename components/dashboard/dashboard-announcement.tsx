//ダッシュボードに表示するお知らせのコンポーネント

/*DashboardAnnouncementが呼ばれる
        ↓
お知らせの画面構造を返す
        ↓
Reactが画面に反映する*/

import { Sparkles } from "lucide-react";
import { dashboardAnnouncement } from "@/lib/dashboard/announcement";

export function DashboardAnnouncement() {
  return <section className="dashboard-update" aria-labelledby="dashboard-update-title">
    <p className="dashboard-update-meta">
      {/* お知らせのメタ情報を表示 */}
      <Sparkles size={14} aria-hidden="true" />
      <span>お知らせ</span>
      <time dateTime={dashboardAnnouncement.date}>{dashboardAnnouncement.dateLabel}
      </time>
    </p>
    {/* お知らせのタイトルを表示 */}
    <h2 id="dashboard-update-title">{dashboardAnnouncement.title}</h2>
    {/* お知らせ本文を表示*/}
    {dashboardAnnouncement.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
  </section>;
}
