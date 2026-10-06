import { useState } from "react";
import { DocumentRow } from "../components/DocumentList.jsx";
import { ExtrasList, PaymentHistory } from "../components/Ledger.jsx";
import OwnershipCard from "../components/OwnershipCard.jsx";
import PaymentForm from "../components/PaymentForm.jsx";
import { AGREEMENT_STATUS, formatDate, formatMoney } from "../lib/format.js";
import { driverLink } from "../lib/route.js";
import { errorMessage, supabase } from "../lib/supabase.js";
import { must, useLoad } from "../lib/useLoad.js";
import { BackButton, Badge, Button, Card, Empty, Loading, Notice, Sheet } from "../ui.jsx";
import {
  AdjustmentSheet,
  AgreementPriceSheet,
  DeleteDocumentButton,
  DeleteDriverSheet,
  DocumentSheet,
  DriverFormSheet,
  ExtraSheet,
  RejectSheet,
  StartAgreementSheet,
  TerminateSheet,
} from "./forms.jsx";

async function loadDriver(driverId, agreementId) {
  const [driver, documents, agreements] = await Promise.all([
    must(supabase.from("drivers").select("*").eq("id", driverId).single()),
    must(supabase.from("document_status").select("*").eq("driver_id", driverId).order("created_at", { ascending: false })),
    must(
      supabase
        .from("agreement_summary")
        .select("*")
        .eq("driver_id", driverId)
        .order("start_date", { ascending: false })
    ),
  ]);
  const current =
    agreements.find((a) => a.agreement_id === agreementId) ??
    agreements.find((a) => a.status === "active") ??
    agreements[0] ??
    null;

  if (!current) return { driver, documents, agreements, current: null, payments: [], extras: [], adjustments: [], vehicle: null };

  const [payments, extras, adjustments, vehicle] = await Promise.all([
    must(
      supabase
        .from("payments")
        .select("*")
        .eq("agreement_id", current.agreement_id)
        .order("paid_on", { ascending: false })
        .order("created_at", { ascending: false })
    ),
    must(supabase.from("extras").select("*").eq("agreement_id", current.agreement_id).order("date", { ascending: false })),
    must(supabase.from("adjustments").select("*").eq("agreement_id", current.agreement_id).order("date", { ascending: false })),
    must(supabase.from("vehicles").select("*").eq("id", current.vehicle_id).single()),
  ]);
  return { driver, documents, agreements, current, payments, extras, adjustments, vehicle };
}

function whatsappNumber(phone) {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("233")) return digits;
  if (digits.startsWith("0")) return `233${digits.slice(1)}`;
  return digits;
}

export default function DriverDetail({ driverId, onBack, onChanged }) {
  const [agreementId, setAgreementId] = useState(null);
  const { data, error, reload } = useLoad(() => loadDriver(driverId, agreementId), [driverId, agreementId]);
  const [sheet, setSheet] = useState(null); // { kind, payload }
  const [flash, setFlash] = useState({ tone: "", text: "" });

  if (error && !data) return <Notice tone="red">{error}</Notice>;
  if (!data) return <Loading />;

  const { driver, documents, agreements, current, payments, extras, adjustments, vehicle } = data;
  const active = current?.status === "active";
  const link = driverLink(driver.access_token);
  const wa = whatsappNumber(driver.phone);

  const refresh = (text) => {
    if (text) setFlash({ tone: "green", text });
    reload();
    onChanged?.();
  };
  const close = () => setSheet(null);
  const fail = (err) => setFlash({ tone: "red", text: errorMessage(err) });

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setFlash({ tone: "green", text: "Link copied." });
    } catch {
      window.prompt("Copy this link:", link);
    }
  }

  async function resetLink() {
    if (!window.confirm(`Make a new link for ${driver.name}? The old link will stop working.`)) return;
    const { error: rpcError } = await supabase.rpc("admin_reset_driver_link", { p_driver_id: driver.id });
    if (rpcError) return fail(rpcError);
    refresh("New link created. Send it to the driver.");
  }

  async function approve(payment) {
    const { error: updateError } = await supabase
      .from("payments")
      .update({ status: "approved" })
      .eq("id", payment.id)
      .eq("status", "pending");
    if (updateError) return fail(updateError);
    refresh(`${formatMoney(payment.amount)} approved.`);
  }

  async function complete() {
    if (!window.confirm(`Mark the car as fully paid and handed over to ${driver.name}? This can't be undone.`)) return;
    const { error: updateError } = await supabase
      .from("agreements")
      .update({ status: "completed" })
      .eq("id", current.agreement_id);
    if (updateError) return fail(updateError);
    refresh("Agreement completed. The car now belongs to the driver.");
  }

  async function recordPayment(values) {
    await must(
      supabase.from("payments").insert({
        ...values,
        agreement_id: current.agreement_id,
        status: "approved",
        submitted_by: "admin",
      })
    );
    close();
    refresh("Payment recorded.");
  }

  const waText = encodeURIComponent(
    `Hello ${driver.name}, this is your payment ledger link. Open it on your phone, then use "Add to Home Screen":\n${link}`
  );

  return (
    <>
      <BackButton onClick={onBack}>All drivers</BackButton>
      {flash.text && <Notice tone={flash.tone}>{flash.text}</Notice>}

      <Card
        title={driver.name}
        aside={
          <Button variant="link" onClick={() => setSheet({ kind: "editDriver" })}>
            Edit
          </Button>
        }
      >
        <div className="stack">
          <div className="muted small">{driver.phone || "No phone number"}</div>
          <div className="field-label">Driver's link</div>
          <div className="link-box">{link}</div>
          <div className="actions">
            <Button variant="ghost" className="btn-sm" onClick={copyLink}>
              Copy link
            </Button>
            {wa && (
              <a className="btn btn-ghost btn-sm" style={{ textAlign: "center", textDecoration: "none" }} href={`https://wa.me/${wa}?text=${waText}`} target="_blank" rel="noreferrer">
                Send on WhatsApp
              </a>
            )}
            <Button variant="danger" className="btn-sm" onClick={resetLink}>
              New link
            </Button>
          </div>
        </div>
      </Card>

      {!agreements.some((a) => a.status === "active") && (
        <Card>
          <div className="stack">
            <Empty>{agreements.length ? "No active agreement." : "No car assigned yet."}</Empty>
            <Button onClick={() => setSheet({ kind: "start" })}>Give a car</Button>
          </div>
        </Card>
      )}

      {current && (
        <>
          <OwnershipCard
            agreement={current}
            title={vehicle ? `${vehicle.make_model}${vehicle.plate ? ` · ${vehicle.plate}` : ""}` : "Agreement"}
          >
            <div className="passbook-grid small">
              <div>
                <div className="passbook-label">Started</div>
                {formatDate(current.start_date)}
              </div>
              <div>
                <div className="passbook-label">Price to own</div>
                <span className="money">{formatMoney(current.car_price)}</span>
              </div>
              {current.ended_on && (
                <div>
                  <div className="passbook-label">Ended</div>
                  {formatDate(current.ended_on)}
                </div>
              )}
            </div>
          </OwnershipCard>

          {active && (
            <Card title="Actions">
              <div className="actions">
                <Button onClick={() => setSheet({ kind: "payment" })}>Record payment</Button>
                <Button variant="ghost" onClick={() => setSheet({ kind: "extra" })}>Add to total</Button>
                <Button variant="ghost" onClick={() => setSheet({ kind: "adjust" })}>Correction</Button>
                <Button variant="ghost" onClick={() => setSheet({ kind: "price" })}>Change price</Button>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <Button variant="ghost" disabled={current.remaining > 0} onClick={complete}>
                  Hand over car (fully paid)
                </Button>
                <Button variant="danger" onClick={() => setSheet({ kind: "terminate" })}>
                  Take car back
                </Button>
              </div>
            </Card>
          )}

          <PaymentHistory
            payments={payments}
            adjustments={adjustments}
            renderActions={(p) =>
              p.status === "pending" ? (
                <div className="actions">
                  <Button className="btn-sm btn-approve" onClick={() => approve(p)}>
                    Approve
                  </Button>
                  <Button variant="danger" className="btn-sm" onClick={() => setSheet({ kind: "reject", payload: p })}>
                    Reject
                  </Button>
                </div>
              ) : null
            }
          />
          <ExtrasList extras={extras} showOwnerCost />
        </>
      )}

      <Card
        title="Papers"
        aside={
          <Button className="btn-sm" variant="ghost" onClick={() => setSheet({ kind: "document" })}>
            + Add paper
          </Button>
        }
      >
        {documents.length === 0 ? (
          <Empty>No signed agreement uploaded.</Empty>
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

      <Card title="Danger zone">
        <div className="stack">
          <p className="muted small">
            Deleting removes this driver and every record about them. Use it for test entries and mistakes only.
          </p>
          <Button variant="danger" onClick={() => setSheet({ kind: "deleteDriver" })}>
            Delete {driver.name}
          </Button>
        </div>
      </Card>

      {agreements.length > 1 && (
        <Card title="All agreements">
          <ul className="ledger">
            {agreements.map((a) => (
              <li
                key={a.agreement_id}
                className="ledger-row clickable"
                onClick={() => setAgreementId(a.agreement_id)}
                aria-current={a.agreement_id === current?.agreement_id}
              >
                <div className="ledger-main">
                  <div className="ledger-title">Started {formatDate(a.start_date)}</div>
                  <div className="ledger-meta">
                    {formatMoney(a.paid)} of {formatMoney(a.amount_to_own)}
                    {a.agreement_id === current?.agreement_id ? " · showing" : ""}
                  </div>
                </div>
                <div className="ledger-side">
                  <Badge tone={AGREEMENT_STATUS[a.status].tone}>{AGREEMENT_STATUS[a.status].label}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {sheet?.kind === "editDriver" && <DriverFormSheet driver={driver} onClose={close} onSaved={() => refresh("Driver saved.")} />}
      {sheet?.kind === "start" && (
        <StartAgreementSheet
          driver={driver}
          onClose={close}
          onSaved={() => {
            setAgreementId(null);
            refresh("Agreement started.");
          }}
        />
      )}
      {sheet?.kind === "payment" && (
        <Sheet title="Record payment" onClose={close}>
          <PaymentForm storageKey={driver.storage_key} onSubmit={recordPayment} submitLabel="Record payment" />
        </Sheet>
      )}
      {sheet?.kind === "extra" && <ExtraSheet agreementId={current.agreement_id} onClose={close} onSaved={() => refresh("Added to total.")} />}
      {sheet?.kind === "adjust" && <AdjustmentSheet agreementId={current.agreement_id} onClose={close} onSaved={() => refresh("Correction saved.")} />}
      {sheet?.kind === "reject" && <RejectSheet payment={sheet.payload} onClose={close} onSaved={() => refresh("Payment rejected.")} />}
      {sheet?.kind === "price" && (
        <AgreementPriceSheet agreement={current} onClose={close} onSaved={() => refresh("Price updated.")} />
      )}
      {sheet?.kind === "document" && (
        <DocumentSheet
          driver={driver}
          agreementId={current?.agreement_id}
          onClose={close}
          onSaved={() => refresh("Paper uploaded.")}
        />
      )}
      {sheet?.kind === "deleteDriver" && (
        <DeleteDriverSheet driver={driver} onClose={close} onDeleted={onBack} />
      )}
      {sheet?.kind === "terminate" && <TerminateSheet agreement={current} onClose={close} onSaved={() => refresh("Agreement ended.")} />}
    </>
  );
}
