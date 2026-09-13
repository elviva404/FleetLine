import { PAYMENT_STATUS, SERVICE_STATUS, formatDate, formatMoney } from "../lib/format.js";
import { Badge, Card, Empty, Money, Screenshot } from "../ui.jsx";

export function PaymentHistory({ payments, adjustments, renderActions, title = "Payment history", aside }) {
  const rows = [
    ...payments.map((p) => ({ kind: "payment", date: p.paid_on, row: p })),
    ...adjustments.map((j) => ({ kind: "adjustment", date: j.date, row: j })),
  ].sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));

  return (
    <Card title={title} aside={aside}>
      {rows.length === 0 ? (
        <Empty>No payments yet.</Empty>
      ) : (
        <ul className="ledger">
          {rows.map(({ kind, row }) =>
            kind === "payment" ? (
              <PaymentRow key={row.id} payment={row} actions={renderActions?.(row)} />
            ) : (
              <li key={row.id} className="ledger-row">
                <div className="ledger-main">
                  <div className="ledger-title">{formatDate(row.date)}</div>
                  <div className="ledger-meta">Correction · {row.reason}</div>
                </div>
                <div className="ledger-side">
                  <Money value={formatMoney(row.amount)} className={row.amount < 0 ? "money-red" : "money-green"} />
                </div>
              </li>
            )
          )}
        </ul>
      )}
    </Card>
  );
}

function PaymentRow({ payment: p, actions }) {
  const status = PAYMENT_STATUS[p.status];
  const isDeposit = p.kind === "deposit";
  const details = [p.reference && `Ref ${p.reference}`, !isDeposit && p.note].filter(Boolean).join(" · ");

  return (
    <li className="ledger-row">
      <div className="ledger-main stack" style={{ gap: 4 }}>
        <div>
          <div className="ledger-title">
            {isDeposit ? "Deposit · " : ""}
            {formatDate(p.paid_on)}
          </div>
          <div className="ledger-meta">{details || (isDeposit ? "Paid before handover" : "Payment")}</div>
          {p.submitted_by === "admin" && !isDeposit && <div className="ledger-meta">Recorded by owner</div>}
          {p.status === "rejected" && p.review_note && (
            <div className="ledger-meta" style={{ color: "var(--red)" }}>
              {p.review_note}
            </div>
          )}
        </div>
        {p.screenshot_path && <Screenshot path={p.screenshot_path} />}
        {actions}
      </div>
      <div className="ledger-side">
        <Money value={formatMoney(p.amount)} className={p.status === "rejected" ? "muted" : ""} />
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
    </li>
  );
}

export function ExtrasList({ extras, title = "Added to total", showOwnerCost = false, aside }) {
  const total = extras.reduce((sum, e) => sum + Number(e.amount), 0);
  return (
    <Card title={title} aside={aside ?? <Money value={formatMoney(total)} />}>
      {extras.length === 0 ? (
        <Empty>Nothing added.</Empty>
      ) : (
        <ul className="ledger">
          {extras.map((e) => (
            <li key={e.id} className="ledger-row">
              <div className="ledger-main">
                <div className="ledger-title">{e.description}</div>
                <div className="ledger-meta">
                  {formatDate(e.date)}
                  {showOwnerCost && Number(e.owner_cost) > 0 && ` · you spent ${formatMoney(e.owner_cost)}`}
                </div>
              </div>
              <div className="ledger-side">
                <Money value={formatMoney(e.amount)} className={e.amount < 0 ? "money-green" : ""} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function MaintenanceList({ services }) {
  return (
    <Card title="Car maintenance">
      <ul className="ledger">
        {services.map((s) => {
          const status = SERVICE_STATUS[s.status];
          return (
            <li key={s.service} className="ledger-row">
              <div className="ledger-main">
                <div className="ledger-title">{s.service}</div>
                <div className="ledger-meta">
                  {s.last_performed_on
                    ? `Last done ${formatDate(s.last_performed_on)} · next ${formatDate(s.next_due_on)}`
                    : `Every ${s.interval_days} days`}
                </div>
              </div>
              <div className="ledger-side">
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
