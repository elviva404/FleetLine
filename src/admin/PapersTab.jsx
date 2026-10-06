import { useState } from "react";
import { DocumentRow } from "../components/DocumentList.jsx";
import { supabase } from "../lib/supabase.js";
import { must, useLoad } from "../lib/useLoad.js";
import { Button, Card, Empty, Loading, Notice } from "../ui.jsx";
import { DeleteDocumentButton, DocumentSheet } from "./forms.jsx";

const ORDER = { expired: 0, expiring: 1, valid: 2, none: 3 };

async function loadPapers() {
  const [documents, drivers, vehicles] = await Promise.all([
    must(
      supabase
        .from("document_status")
        .select("*")
        .order("expires_on", { ascending: true, nullsFirst: false })
    ),
    must(supabase.from("drivers").select("id, name").order("name")),
    must(supabase.from("vehicles").select("id, make_model, plate").order("make_model")),
  ]);
  return { documents, drivers, vehicles };
}

export default function PapersTab() {
  const { data, error, reload } = useLoad(loadPapers, []);
  const [sheet, setSheet] = useState(null);

  if (error && !data) return <Notice tone="red">{error}</Notice>;
  if (!data) return <Loading />;

  const { documents, drivers, vehicles } = data;
  const sorted = [...documents].sort((a, b) => ORDER[a.expiry_status] - ORDER[b.expiry_status]);
  const needsAttention = sorted.filter((d) => d.expiry_status === "expired" || d.expiry_status === "expiring");
  const ownerOf = (doc) => {
    if (doc.driver_id) return drivers.find((d) => d.id === doc.driver_id)?.name ?? "Driver";
    const vehicle = vehicles.find((v) => v.id === doc.vehicle_id);
    return vehicle ? `${vehicle.make_model}${vehicle.plate ? ` · ${vehicle.plate}` : ""}` : "Car";
  };
  const close = () => setSheet(null);
  const refresh = () => {
    reload();
    close();
  };

  return (
    <>
      {needsAttention.length > 0 && (
        <Notice tone={needsAttention.some((d) => d.expiry_status === "expired") ? "red" : "amber"}>
          {needsAttention.length === 1
            ? `${needsAttention[0].title} (${ownerOf(needsAttention[0])}) needs renewing.`
            : `${needsAttention.length} papers need renewing.`}
        </Notice>
      )}

      <Card
        title="Papers"
        aside={
          <div className="row">
            <Button className="btn-sm" variant="ghost" onClick={() => setSheet({ kind: "driver" })} disabled={!drivers.length}>
              + Agreement
            </Button>
            <Button className="btn-sm" onClick={() => setSheet({ kind: "vehicle" })} disabled={!vehicles.length}>
              + Car paper
            </Button>
          </div>
        }
      >
        {sorted.length === 0 ? (
          <Empty>
            Nothing uploaded yet. Add each driver's signed agreement, and insurance and roadworthy for every car.
          </Empty>
        ) : (
          <ul className="ledger">
            {sorted.map((doc) => (
              <DocumentRow
                key={doc.id}
                document={{ ...doc, title: `${doc.title} — ${ownerOf(doc)}` }}
                action={<DeleteDocumentButton document={doc} onDeleted={reload} />}
              />
            ))}
          </ul>
        )}
      </Card>

      {sheet?.kind === "driver" && <PickOne
        title="Whose agreement?"
        options={drivers.map((d) => ({ id: d.id, label: d.name }))}
        onClose={close}
        onPick={(id) => setSheet({ kind: "upload", driver: drivers.find((d) => d.id === id) })}
      />}
      {sheet?.kind === "vehicle" && <PickOne
        title="Which car?"
        options={vehicles.map((v) => ({ id: v.id, label: `${v.make_model}${v.plate ? ` · ${v.plate}` : ""}` }))}
        onClose={close}
        onPick={(id) => setSheet({ kind: "upload", vehicle: vehicles.find((v) => v.id === id) })}
      />}
      {sheet?.kind === "upload" && (
        <DocumentSheet driver={sheet.driver} vehicle={sheet.vehicle} onClose={close} onSaved={refresh} />
      )}
    </>
  );
}

function PickOne({ title, options, onPick, onClose }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 className="card-title">{title}</h2>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <ul className="ledger">
          {options.map((option) => (
            <li key={option.id} className="ledger-row clickable" onClick={() => onPick(option.id)}>
              <div className="ledger-main">
                <div className="ledger-title">{option.label}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
