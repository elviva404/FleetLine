import { useState } from "react";
import { formatDate, formatMoney } from "../lib/format.js";
import { errorMessage, supabase } from "../lib/supabase.js";
import { reviewPayment } from "../lib/momo.js";
import { must, useLoad } from "../lib/useLoad.js";
import { Button, Card, Empty, Loading, Money, Notice, Screenshot } from "../ui.jsx";
import { RejectSheet } from "./forms.jsx";

export default function ApprovalsTab({ onChanged }) {
  const { data, error, reload } = useLoad(async () => {
    const [pending, settings] = await Promise.all([
      must(
        supabase
          .from("payments")
          .select("*, agreement:agreements(driver:drivers(name), vehicle:vehicles(make_model, plate))")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
      ),
      must(supabase.from("settings").select("momo_accounts").eq("id", 1).single()),
    ]);
    return { pending, ownerAccounts: settings.momo_accounts ?? [] };
  }, []);
  const [rejecting, setRejecting] = useState(null);
  const [flash, setFlash] = useState({ tone: "", text: "" });

  const refresh = (text) => {
    setFlash({ tone: "green", text });
    reload();
    onChanged?.();
  };

  async function approve(payment) {
    const { error: updateError } = await supabase
      .from("payments")
      .update({ status: "approved" })
      .eq("id", payment.id)
      .eq("status", "pending");
    if (updateError) {
      setFlash({ tone: "red", text: errorMessage(updateError) });
      return;
    }
    refresh(`${formatMoney(payment.amount)} from ${payment.agreement.driver.name} approved.`);
  }

  if (error && !data) return <Notice tone="red">{error}</Notice>;
  if (!data) return <Loading />;
  const { pending, ownerAccounts } = data;

  return (
    <>
      {flash.text && <Notice tone={flash.tone}>{flash.text}</Notice>}
      <Card title="Waiting for approval" aside={<span className="muted small">{pending.length}</span>}>
        {pending.length === 0 ? (
          <Empty>Nothing to approve. Check each payment against your MoMo statement before approving.</Empty>
        ) : (
          <ul className="ledger">
            {pending.map((p) => (
              <li key={p.id} className="ledger-row">
                <div className="ledger-main stack">
                  <div>
                    <div className="ledger-title">{p.agreement.driver.name}</div>
                    <div className="ledger-meta">
                      {p.agreement.vehicle.make_model}
                      {p.agreement.vehicle.plate ? ` · ${p.agreement.vehicle.plate}` : ""}
                    </div>
                    <div className="ledger-meta">
                      Paid {formatDate(p.paid_on)}
                      {p.reference ? ` · Ref ${p.reference}` : " · no transaction ID"}
                    </div>
                    {p.note && <div className="ledger-meta">“{p.note}”</div>}
                    {p.ocr_source && (
                      <div className="ledger-meta">
                        {p.ocr_source === "screenshot" ? "Read from screenshot" : "Read from pasted message"}
                        {p.ocr_receiver ? `: paid to ${p.ocr_receiver}` : ""}
                      </div>
                    )}
                  </div>
                  {reviewPayment(p, ownerAccounts).map((warning, index) => (
                    <Notice key={index} tone={warning.tone}>
                      {warning.text}
                    </Notice>
                  ))}
                  {p.screenshot_path ? (
                    <Screenshot path={p.screenshot_path} large />
                  ) : (
                    <span className="ledger-meta">No screenshot</span>
                  )}
                  <div className="actions">
                    <Button className="btn-sm btn-approve" onClick={() => approve(p)}>
                      Approve
                    </Button>
                    <Button variant="danger" className="btn-sm" onClick={() => setRejecting(p)}>
                      Reject
                    </Button>
                  </div>
                </div>
                <div className="ledger-side">
                  <Money value={formatMoney(p.amount)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {rejecting && (
        <RejectSheet payment={rejecting} onClose={() => setRejecting(null)} onSaved={() => refresh("Payment rejected.")} />
      )}
    </>
  );
}
