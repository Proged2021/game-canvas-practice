import { Sparkles } from "lucide-react";
import { dashboardAnnouncement } from "@/lib/dashboard/announcement";

export function DashboardAnnouncement() {
  return <section className="dashboard-update" aria-labelledby="dashboard-update-title">
    <p className="dashboard-update-meta"><Sparkles size={14} aria-hidden="true" /><span>お知らせ</span><time dateTime={dashboardAnnouncement.date}>{dashboardAnnouncement.dateLabel}</time></p>
    <h2 id="dashboard-update-title">{dashboardAnnouncement.title}</h2>
    {dashboardAnnouncement.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
  </section>;
}
