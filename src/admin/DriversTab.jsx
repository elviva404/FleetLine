import { useState } from "react";
import { AGREEMENT_STATUS, formatMoney, formatPercent, scheduleStatus } from "../lib/format.js";
import { supabase } from "../lib/supabase.js";
import { must, useLoad } from "../lib/useLoad.js";
import { Badge, Button, Card, Empty, Loading, Money, Notice, ProgressBar } from "../ui.jsx";
import DriverDetail from "./DriverDetail.jsx";
import { DriverFormSheet } from "./forms.jsx";

export default function DriversTab({ onChanged }) {
  const [selectedId, setSelectedId] = useState(null);
  const [adding, setAdding] = useState(false);
  const { data: drivers, error, reload } = useLoad(
    () => must(supabase.from("admin_driver_overview").select("*").order("name")),
    []
  );

  if (selectedId) {
    return (
      <DriverDetail
        driverId={selectedId}
        onBack={() => {
          setSelectedId(null);
          reload();
        }}
        onChanged={onChanged}
      />
    );
  }

  if (error && !drivers) return <Notice tone="red">{error}</Notice>;
  if (!drivers) return <Loading />;

  return (
    <>
      <Card
        title="Drivers"
        aside={
          <Button className="btn-sm" onClick={() => setAdding(true)}>
            + Add driver
          </Button>
        }
      >
        {drivers.length === 0 ? (
          <Empty>No drivers yet. Add your first driver, then give them a car.</Empty>
        ) : (
          <ul className="ledger">
            {drivers.map((d) => (
              <DriverRow key={d.driver_id} driver={d} onOpen={() => setSelectedId(d.driver_id)} />
            ))}
          </ul>
        )}
      </Card>
      {adding && (
        <DriverFormSheet
          onClose={() => setAdding(false)}
          onSaved={(saved) => {
            reload();
            setSelectedId(saved.id);
          }}
        />
      )}
    </>
  );
}

function DriverRow({ driver: d, onOpen }) {
  const hasAgreement = Boolean(d.agreement_id);
  const status = AGREEMENT_STATUS[d.agreement_status];
  const schedule = d.agreement_status === "active" ? scheduleStatus(d.schedule_diff) : null;

  return (
    <li className="ledger-row clickable" onClick={onOpen}>
      <div className="ledger-main stack" style={{ gap: 6 }}>
        <div className="row">
          <span className="ledger-title">{d.name}</span>
          {status && <Badge tone={status.tone}>{status.label}</Badge>}
          {d.pending_count > 0 && <Badge tone="amber">{d.pending_count} to approve</Badge>}
          {d.overdue_services > 0 && <Badge tone="red">Service overdue</Badge>}
        </div>
        <div className="ledger-meta">
          {hasAgreement ? `${d.make_model}${d.plate ? ` · ${d.plate}` : ""}` : "No car assigned"}
        </div>
        {hasAgreement && (
          <>
            <ProgressBar value={d.progress} />
            <div className="ledger-meta">
              {formatPercent(d.progress)} of {formatMoney(d.amount_to_own)} paid
            </div>
          </>
        )}
      </div>
      {hasAgreement && (
        <div className="ledger-side">
          <Money value={formatMoney(Math.max(0, d.remaining))} />
          <span className="ledger-meta">left</span>
          {schedule && <Badge tone={schedule.tone}>{schedule.label}</Badge>}
        </div>
      )}
    </li>
  );
}
