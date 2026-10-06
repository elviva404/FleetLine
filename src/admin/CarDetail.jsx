import { useState } from "react";
import { SERVICE_STATUS, formatDate, formatMoney } from "../lib/format.js";
import { supabase } from "../lib/supabase.js";
import { must, useLoad } from "../lib/useLoad.js";
import { BackButton, Badge, Button, Card, Empty, Loading, Money, Notice } from "../ui.jsx";
import { DocumentRow } from "../components/DocumentList.jsx";
import { DeleteDocumentButton, DocumentSheet, IntervalSheet, MaintenanceSheet, VehicleCostSheet, VehicleFormSheet } from "./forms.jsx";

const COST_LABELS = {
  insurance: "Insurance",
  roadworthy: "Roadworthy",
  registration: "Registration",
  repair: "Repair",
  other: "Other",
};

async function loadCar(vehicleId) {
  const [vehicle, services, logs, costs, finance, serviceTypes, agreements, documents] = await Promise.all([
    must(supabase.from("vehicles").select("*").eq("id", vehicleId).single()),
    must(supabase.from("vehicle_service_status").select("*").eq("vehicle_id", vehicleId).order("service_name")),
    must(
      supabase
        .from("maintenance_logs")
        .select("*, service_type:service_types(name)")
        .eq("vehicle_id", vehicleId)
        .order("performed_on", { ascending: false })
    ),
    must(supabase.from("vehicle_costs").select("*").eq("vehicle_id", vehicleId).order("date", { ascending: false })),
    must(supabase.from("vehicle_finance").select("*").eq("vehicle_id", vehicleId).maybeSingle()),
    must(supabase.from("service_types").select("*").eq("archived", false).order("name")),
    must(
      supabase
        .from("agreements")
        .select("status, start_date, driver:drivers(id, name)")
        .eq("vehicle_id", vehicleId)
        .order("start_date", { ascending: false })
    ),
    must(
      supabase
        .from("document_status")
        .select("*")
        .eq("vehicle_id", vehicleId)
        .order("expires_on", { ascending: true, nullsFirst: false })
    ),
  ]);
  return { vehicle, services, logs, costs, finance, serviceTypes, agreements, documents };
}

export default function CarDetail({ vehicleId, onBack }) {
  const { data, error, reload } = useLoad(() => loadCar(vehicleId), [vehicleId]);
  const [sheet, setSheet] = useState(null);

  if (error && !data) return <Notice tone="red">{error}</Notice>;
  if (!data) return <Loading />;

  const { vehicle, services, logs, costs, finance, serviceTypes, agreements, documents } = data;
  const current = agreements.find((a) => a.status === "active") ?? agreements[0] ?? null;
  const close = () => setSheet(null);
  const refresh = () => {
    reload();
    close();
  };

  return (
    <>
      <BackButton onClick={onBack}>All cars</BackButton>

      <Card
        title={vehicle.make_model}
        aside={
          <Button variant="link" onClick={() => setSheet({ kind: "edit" })}>
            Edit
          </Button>
        }
      >
        <div className="stack">
          <div className="muted small">
            {vehicle.plate || "No plate"}
            {vehicle.purchase_date ? ` · bought ${formatDate(vehicle.purchase_date)}` : ""}
          </div>
          <div className="small">
            {current
              ? `${current.status === "active" ? "With" : current.status === "completed" ? "Owned by" : "Last with"} ${current.driver.name}`
              : "Not given to anyone yet"}
          </div>
          {vehicle.notes && <div className="muted small">{vehicle.notes}</div>}
        </div>
      </Card>

      {finance && <FinanceCard finance={finance} />}

      <Card
        title="Papers"
        aside={
          <Button className="btn-sm" variant="ghost" onClick={() => setSheet({ kind: "document" })}>
            + Add paper
          </Button>
        }
      >
        {documents.length === 0 ? (
          <Empty>No insurance or roadworthy uploaded for this car.</Empty>
        ) : (
          <ul className="ledger">
            {documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                document={doc}
                action={<DeleteDocumentButton document={doc} onDeleted={reload} />}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Maintenance"
        aside={
          serviceTypes.length > 0 && (
            <Button className="btn-sm" onClick={() => setSheet({ kind: "service" })}>
              + Log service
            </Button>
          )
        }
      >
        {services.length === 0 ? (
          <Empty>
            {serviceTypes.length === 0
              ? "Add service types in Settings first."
              : "This car has been handed over, so services are no longer tracked."}
          </Empty>
        ) : (
          <ul className="ledger">
            {services.map((s) => {
              const status = SERVICE_STATUS[s.status];
              return (
                <li key={s.service_type_id} className="ledger-row clickable" onClick={() => setSheet({ kind: "interval", service: s })}>
                  <div className="ledger-main">
                    <div className="ledger-title">{s.service_name}</div>
                    <div className="ledger-meta">
                      {s.last_performed_on
                        ? `Last done ${formatDate(s.last_performed_on)} · next ${formatDate(s.next_due_on)}`
                        : `Never logged · every ${s.interval_days} days`}
                    </div>
                  </div>
                  <div className="ledger-side">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <span className="ledger-meta">every {s.interval_days}d</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Service history">
        {logs.length === 0 ? (
          <Empty>Nothing logged yet.</Empty>
        ) : (
          <ul className="ledger">
            {logs.map((log) => (
              <li key={log.id} className="ledger-row">
                <div className="ledger-main">
                  <div className="ledger-title">{log.service_type?.name ?? "Service"}</div>
                  <div className="ledger-meta">
                    {formatDate(log.performed_on)}
                    {log.note ? ` · ${log.note}` : ""}
                  </div>
                </div>
                <div className="ledger-side">
                  <Money value={Number(log.owner_cost) > 0 ? formatMoney(log.owner_cost) : "—"} />
                  <span className="ledger-meta">{Number(log.owner_cost) > 0 ? "you paid" : "driver paid"}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Other costs"
        aside={
          <Button className="btn-sm" variant="ghost" onClick={() => setSheet({ kind: "cost" })}>
            + Add cost
          </Button>
        }
      >
        {costs.length === 0 ? (
          <Empty>No insurance, roadworthy or repair costs recorded.</Empty>
        ) : (
          <ul className="ledger">
            {costs.map((cost) => (
              <li key={cost.id} className="ledger-row">
                <div className="ledger-main">
                  <div className="ledger-title">{COST_LABELS[cost.category] ?? cost.category}</div>
                  <div className="ledger-meta">
                    {formatDate(cost.date)}
                    {cost.note ? ` · ${cost.note}` : ""}
                  </div>
                </div>
                <div className="ledger-side">
                  <Money value={formatMoney(cost.amount)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {sheet?.kind === "edit" && (
        <VehicleFormSheet vehicle={vehicle} onClose={close} onSaved={() => { reload(); }} />
      )}
      {sheet?.kind === "service" && (
        <MaintenanceSheet vehicle={vehicle} serviceTypes={serviceTypes} onClose={close} onSaved={refresh} />
      )}
      {sheet?.kind === "cost" && <VehicleCostSheet vehicle={vehicle} onClose={close} onSaved={refresh} />}
      {sheet?.kind === "document" && (
        <DocumentSheet vehicle={vehicle} onClose={close} onSaved={refresh} />
      )}
      {sheet?.kind === "interval" && (
        <IntervalSheet vehicle={vehicle} service={sheet.service} onClose={close} onSaved={refresh} />
      )}
    </>
  );
}

export function FinanceCard({ finance: f, title = "Money on this car" }) {
  const brokenEven = Number(f.net_position) > 0;
  return (
    <Card className="passbook" title={title}>
      <div className="passbook-label">{brokenEven ? "Profit so far" : "Left to break even"}</div>
      <div className="passbook-figure">
        {formatMoney(brokenEven ? f.net_position : f.remaining_to_break_even)}
      </div>
      <div className="passbook-grid">
        <Stat label="Collected" value={formatMoney(f.collected)} />
        <Stat label="Car cost you" value={formatMoney(f.cost_basis)} />
        <Stat label="Purchase price" value={formatMoney(f.purchase_price)} />
        <Stat label="Running costs" value={formatMoney(f.running_costs)} />
        {f.profit_per_week_avg != null && (
          <Stat label="Profit a week (so far)" value={formatMoney(f.profit_per_week_avg)} />
        )}
        {f.profit_per_week_forward != null && (
          <Stat label="Profit a week (going on)" value={formatMoney(f.profit_per_week_forward)} />
        )}
        {f.expected_total_profit != null && (
          <Stat label="Expected total profit" value={formatMoney(f.expected_total_profit)} />
        )}
        {f.weeks_active != null && <Stat label="Weeks working" value={f.weeks_active} />}
      </div>
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
