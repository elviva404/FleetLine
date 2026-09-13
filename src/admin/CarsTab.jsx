import { useState } from "react";
import { formatDate, formatMoney } from "../lib/format.js";
import { supabase } from "../lib/supabase.js";
import { must, useLoad } from "../lib/useLoad.js";
import { Badge, Button, Card, Empty, Loading, Money, Notice } from "../ui.jsx";
import { VehicleFormSheet } from "./forms.jsx";

function carStatus(vehicle) {
  const active = vehicle.agreements.find((a) => a.status === "active");
  if (active) return { tone: "navy", label: `With ${active.driver.name}` };
  const completed = vehicle.agreements.find((a) => a.status === "completed");
  if (completed) return { tone: "green", label: `Owned by ${completed.driver.name}` };
  return { tone: "amber", label: "Available" };
}

export default function CarsTab() {
  const { data: vehicles, error, reload } = useLoad(
    () =>
      must(
        supabase
          .from("vehicles")
          .select("*, agreements(status, driver:drivers(name))")
          .order("make_model")
      ),
    []
  );
  const [editing, setEditing] = useState(null); // null | "new" | vehicle

  if (error && !vehicles) return <Notice tone="red">{error}</Notice>;
  if (!vehicles) return <Loading />;

  return (
    <>
      <Card
        title="Cars"
        aside={
          <Button className="btn-sm" onClick={() => setEditing("new")}>
            + Add car
          </Button>
        }
      >
        {vehicles.length === 0 ? (
          <Empty>No cars yet.</Empty>
        ) : (
          <ul className="ledger">
            {vehicles.map((v) => {
              const status = carStatus(v);
              return (
                <li key={v.id} className="ledger-row clickable" onClick={() => setEditing(v)}>
                  <div className="ledger-main">
                    <div className="ledger-title">{v.make_model}</div>
                    <div className="ledger-meta">
                      {v.plate || "No plate"}
                      {v.purchase_date ? ` · bought ${formatDate(v.purchase_date)}` : ""}
                    </div>
                  </div>
                  <div className="ledger-side">
                    <Money value={formatMoney(v.purchase_price)} />
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {editing && (
        <VehicleFormSheet
          vehicle={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </>
  );
}
