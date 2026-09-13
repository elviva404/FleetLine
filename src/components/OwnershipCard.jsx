import { AGREEMENT_STATUS, formatMoney, formatPercent, scheduleStatus } from "../lib/format.js";
import { Badge, Card, Money, ProgressBar } from "../ui.jsx";

export default function OwnershipCard({ agreement: a, title = "Road to ownership", children }) {
  const status = AGREEMENT_STATUS[a.status];
  const schedule = scheduleStatus(a.schedule_diff);
  const active = a.status === "active";

  return (
    <Card className="passbook" title={title} aside={<Badge tone={status.tone}>{status.label}</Badge>}>
      <div className="passbook-label">{a.status === "completed" ? "Fully paid" : "Left to pay"}</div>
      <div className="passbook-figure">{formatMoney(Math.max(0, a.remaining))}</div>
      <ProgressBar value={a.progress} />
      <div className="spread small" style={{ marginTop: 8 }}>
        <span>{formatPercent(a.progress)} paid</span>
        {active && <Badge tone={schedule.tone}>{schedule.label}</Badge>}
      </div>
      <div className="passbook-grid">
        <Stat label="Paid so far" value={formatMoney(a.paid)} />
        <Stat label="Total to own" value={formatMoney(a.amount_to_own)} />
        {Number(a.deposit) > 0 && <Stat label="Deposit (included)" value={formatMoney(a.deposit)} />}
        {active &&<Stat label="Weeks left (about)" value={a.est_weeks_left ?? "—"} />}
        {Number(a.pending_total) > 0 && <Stat label="Waiting for approval" value={formatMoney(a.pending_total)} />}
      </div>
      {children}
    </Card>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="passbook-label">{label}</div>
      <Money value={value} />
    </div>
  );
}
