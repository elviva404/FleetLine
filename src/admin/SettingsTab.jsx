import { useEffect, useState } from "react";
import { errorMessage, supabase } from "../lib/supabase.js";
import { Button, Card, Field, Loading, Notice } from "../ui.jsx";

export default function SettingsTab() {
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState({ tone: "", text: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("settings")
      .select("weekly_installment, due_soon_days")
      .eq("id", 1)
      .single()
      .then(({ data, error }) => {
        if (error) setStatus({ tone: "red", text: errorMessage(error) });
        else setForm({ weekly_installment: String(data.weekly_installment), due_soon_days: String(data.due_soon_days) });
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
      })
      .eq("id", 1);
    setSaving(false);
    setStatus(error ? { tone: "red", text: errorMessage(error) } : { tone: "green", text: "Saved." });
  }

  if (!form) return status.text ? <Notice tone="red">{status.text}</Notice> : <Loading />;

  return (
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
        {status.text && <Notice tone={status.tone}>{status.text}</Notice>}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </form>
    </Card>
  );
}
