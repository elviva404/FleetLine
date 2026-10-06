import { formatDate } from "../lib/format.js";
import { supabase } from "../lib/supabase.js";
import { must, useLoad } from "../lib/useLoad.js";
import { Card, Empty, Loading, Notice } from "../ui.jsx";

function when(timestamp) {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" });
  const day = date.toLocaleDateString("en-CA", { timeZone: "Africa/Accra" });
  return `${formatDate(day)}, ${time}`;
}

// Everything that changed, newest first. The log cannot be edited by anyone.
export default function HistoryCard({ limit = 50 }) {
  const { data: entries, error } = useLoad(
    () => must(supabase.from("audit_log").select("*").order("id", { ascending: false }).limit(limit)),
    [limit]
  );

  return (
    <Card title="History" aside={<span className="muted small">last {limit} changes</span>}>
      {error && <Notice tone="red">{error}</Notice>}
      {!entries && !error && <Loading />}
      {entries && entries.length === 0 && <Empty>Nothing recorded yet.</Empty>}
      {entries && entries.length > 0 && (
        <ul className="ledger">
          {entries.map((entry) => (
            <li key={entry.id} className="ledger-row">
              <div className="ledger-main">
                <div className="ledger-title">{entry.summary}</div>
                <div className="ledger-meta">
                  {when(entry.at)} · {entry.actor === "driver link" ? "by a driver" : entry.actor}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
