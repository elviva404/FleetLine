import { useState } from "react";
import { ExtrasList, MaintenanceList, PaymentHistory } from "../components/Ledger.jsx";
import OwnershipCard from "../components/OwnershipCard.jsx";
import PaymentForm from "../components/PaymentForm.jsx";
import { errorMessage, supabase } from "../lib/supabase.js";
import { useLoad } from "../lib/useLoad.js";
import { Button, Card, Empty, Loading, Masthead, Notice, Page, Sheet } from "../ui.jsx";

async function loadPortal(token) {
  if (import.meta.env.DEV && token === "demo") {
    return (await import("./demoPortal.js")).demoPortal;
  }
  const { data, error } = await supabase.rpc("driver_portal", { p_token: token });
  if (error) throw error;
  return data;
}

export default function DriverApp({ token }) {
  const { data: portal, error, reload } = useLoad(() => loadPortal(token), [token]);
  const [editing, setEditing] = useState(null); // null | "new" | payment
  const [flash, setFlash] = useState("");

  if (error && !portal) {
    return (
      <div className="center-screen">
        <Card title="Can't open your ledger">
          <div className="stack">
            <Notice tone="red">{error}</Notice>
            <Button variant="ghost" onClick={reload}>
              Try again
            </Button>
          </div>
        </Card>
      </div>
    );
  }
  if (!portal) return <Loading label="Opening your ledger…" />;

  const { driver, agreement, vehicle } = portal;
  const canLog = agreement?.status === "active";

  async function submit(values) {
    if (editing === "new") {
      const { error: rpcError } = await supabase.rpc("driver_submit_payment", {
        p_token: token,
        p_amount: values.amount,
        p_paid_on: values.paid_on,
        p_reference: values.reference,
        p_note: values.note,
        p_screenshot_path: values.screenshot_path,
      });
      if (rpcError) throw rpcError;
      setFlash("Payment sent. It will count once the owner approves it.");
    } else {
      const { error: rpcError } = await supabase.rpc("driver_update_payment", {
        p_token: token,
        p_payment_id: editing.id,
        p_amount: values.amount,
        p_paid_on: values.paid_on,
        p_reference: values.reference,
        p_note: values.note,
        p_screenshot_path: values.screenshot_path,
      });
      if (rpcError) throw rpcError;
      setFlash("Payment updated.");
    }
    setEditing(null);
    reload();
  }

  async function remove(payment) {
    if (!window.confirm("Delete this pending payment?")) return;
    const { error: rpcError } = await supabase.rpc("driver_delete_payment", {
      p_token: token,
      p_payment_id: payment.id,
    });
    if (rpcError) {
      setFlash("");
      window.alert(errorMessage(rpcError));
      return;
    }
    setFlash("Payment deleted.");
    reload();
  }

  return (
    <>
      <Masthead
        title={driver.name}
        subtitle={vehicle ? `${vehicle.make_model}${vehicle.plate ? ` · ${vehicle.plate}` : ""}` : null}
      />
      <Page>
        {flash && <Notice tone="green">{flash}</Notice>}
        {error && <Notice tone="red">{error}</Notice>}

        {agreement ? (
          <OwnershipCard agreement={agreement}>
            {canLog && (
              <Button
                variant="gold"
                style={{ width: "100%", marginTop: 16 }}
                onClick={() => {
                  setFlash("");
                  setEditing("new");
                }}
              >
                + Log a payment
              </Button>
            )}
          </OwnershipCard>
        ) : (
          <Card>
            <Empty>No car has been assigned to you yet.</Empty>
          </Card>
        )}

        {agreement && (
          <PaymentHistory
            payments={portal.payments}
            adjustments={portal.adjustments}
            renderActions={(p) =>
              p.status === "pending" && p.submitted_by === "driver" && canLog ? (
                <div className="actions">
                  <Button type="button" variant="ghost" className="btn-sm" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                  <Button type="button" variant="danger" className="btn-sm" onClick={() => remove(p)}>
                    Delete
                  </Button>
                </div>
              ) : null
            }
          />
        )}
        {portal.extras.length > 0 && <ExtrasList extras={portal.extras} title="Added to your total" />}
        {portal.maintenance.length > 0 && <MaintenanceList services={portal.maintenance} />}
      </Page>

      {editing && (
        <Sheet title={editing === "new" ? "Log a payment" : "Edit payment"} onClose={() => setEditing(null)}>
          <PaymentForm
            initial={editing === "new" ? null : editing}
            defaultAmount={portal.weekly_installment}
            storageKey={portal.storage_key}
            onSubmit={submit}
            submitLabel={editing === "new" ? "Send payment" : "Save changes"}
          />
        </Sheet>
      )}
    </>
  );
}
