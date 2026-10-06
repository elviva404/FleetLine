import { useEffect, useState } from "react";
import { errorMessage, supabase } from "../lib/supabase.js";
import { must, useLoad } from "../lib/useLoad.js";
import { ServiceTypeSheet } from "./forms.jsx";
import { Badge, Button, Card, Empty, Field, Loading, Notice } from "../ui.jsx";

export default function SettingsTab() {
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState({ tone: "", text: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("settings")
      .select("weekly_installment, due_soon_days, momo_accounts")
      .eq("id", 1)
      .single()
      .then(({ data, error }) => {
        if (error) setStatus({ tone: "red", text: errorMessage(error) });
        else
          setForm({
            weekly_installment: String(data.weekly_installment),
            due_soon_days: String(data.due_soon_days),
            momo_accounts: (data.momo_accounts ?? []).join("\n"),
          });
      });
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setStatus({ tone: "", text: "" });
    const { error } = await supabase
      .from("settings")
      .update({
        weekly_installment: Number(form.weekly_installment),
        due_soon_days: Number(form.due_soon_days),
        momo_accounts: form.momo_accounts
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      })
      .eq("id", 1);
    setSaving(false);
    setStatus(error ? { tone: "red", text: errorMessage(error) } : { tone: "green", text: "Saved." });
  }

  if (!form) return status.text ? <Notice tone="red">{status.text}</Notice> : <Loading />;

  return (
    <>
    <Card title="Settings">
      <form className="form" onSubmit={handleSubmit}>
        <Field label="Weekly installment (GH₵)" hint="Same for every driver. Used to work out whether a driver is on schedule.">
          <input
            className="input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            required
            value={form.weekly_installment}
            onChange={(e) => setForm({ ...form, weekly_installment: e.target.value })}
          />
        </Field>
        <Field label="Warn about services this many days early">
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min="0"
            max="60"
            required
            value={form.due_soon_days}
            onChange={(e) => setForm({ ...form, due_soon_days: e.target.value })}
          />
        </Field>
        <Field
          label="Your MoMo accounts"
          hint="One per line: the name that appears on drivers' confirmations, and your MoMo number(s). Used to flag payments sent to someone else."
        >
          <textarea
            className="input"
            rows={3}
            placeholder={"Elikem Savie\n0249409007"}
            value={form.momo_accounts}
            onChange={(e) => setForm({ ...form, momo_accounts: e.target.value })}
          />
        </Field>
        {status.text && <Notice tone={status.tone}>{status.text}</Notice>}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </form>
    </Card>
    <ServiceTypesCard />
    </>
  );
}

function ServiceTypesCard() {
  const { data: types, error, reload } = useLoad(
    () => must(supabase.from("service_types").select("*").eq("archived", false).order("name")),
    []
  );
  const [editing, setEditing] = useState(null); // null | "new" | serviceType

  return (
    <>
      <Card
        title="Services to track"
        aside={
          <Button className="btn-sm" onClick={() => setEditing("new")}>
            + Add service
          </Button>
        }
      >
        {error && <Notice tone="red">{error}</Notice>}
        {!types && !error && <Loading />}
        {types && types.length === 0 && <Empty>Nothing tracked yet. Add one, e.g. Oil change every 30 days.</Empty>}
        {types && types.length > 0 && (
          <ul className="ledger">
            {types.map((t) => (
              <li key={t.id} className="ledger-row clickable" onClick={() => setEditing(t)}>
                <div className="ledger-main">
                  <div className="ledger-title">{t.name}</div>
                  <div className="ledger-meta">Due every {t.default_interval_days} days</div>
                </div>
                <div className="ledger-side">
                  <Badge tone="muted">Edit</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && (
        <ServiceTypeSheet
          serviceType={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </>
  );
}
