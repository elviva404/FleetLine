import { useEffect, useState } from "react";
import { todayAccra } from "../lib/format.js";
import { compressImage } from "../lib/images.js";
import { uploadScreenshot } from "../lib/storage.js";
import { errorMessage } from "../lib/supabase.js";
import { Button, Field, Notice, Screenshot } from "../ui.jsx";

// Shared by the driver ("Log a payment") and the owner ("Record payment").
// onSubmit receives { amount, paid_on, reference, note, screenshot_path }.
export default function PaymentForm({ initial, defaultAmount, storageKey, onSubmit, submitLabel = "Submit payment" }) {
  const [amount, setAmount] = useState(initial ? String(initial.amount) : defaultAmount ? String(defaultAmount) : "");
  const [paidOn, setPaidOn] = useState(initial?.paid_on ?? todayAccra());
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [existingPath, setExistingPath] = useState(initial?.screenshot_path ?? null);
  const [image, setImage] = useState(null); // { blob, previewUrl }
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => () => image && URL.revokeObjectURL(image.previewUrl), [image]);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setBusy("Preparing photo…");
    try {
      const blob = await compressImage(file);
      setImage({ blob, previewUrl: URL.createObjectURL(blob) });
      setExistingPath(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy("");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const value = Number(amount);
    if (!(value > 0)) {
      setError("Enter the amount you paid.");
      return;
    }
    setError("");
    try {
      let screenshotPath = existingPath;
      if (image) {
        setBusy("Uploading photo…");
        screenshotPath = await uploadScreenshot(storageKey, image.blob);
      }
      setBusy("Saving…");
      await onSubmit({
        amount: value,
        paid_on: paidOn,
        reference: reference.trim() || null,
        note: note.trim() || null,
        screenshot_path: screenshotPath,
      });
    } catch (err) {
      setError(errorMessage(err));
      setBusy("");
    }
  }

  const hasPhoto = Boolean(image || existingPath);

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="stack">
        <span className="field-label">Payment screenshot</span>
        {image && <img className="preview-img" src={image.previewUrl} alt="Selected screenshot" />}
        {!image && existingPath && <Screenshot path={existingPath} large />}
        <div className="actions">
          <label className="file-button">
            <input type="file" accept="image/*" onChange={handleFile} />
            {hasPhoto ? "Change photo" : "📷 Add MoMo screenshot"}
          </label>
          {hasPhoto && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setImage(null);
                setExistingPath(null);
              }}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      <div className="form-grid">
        <Field label="Amount (GH₵)">
          <input
            className="input"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Date paid">
          <input
            className="input"
            type="date"
            required
            max={todayAccra()}
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Transaction ID" hint="From the MoMo confirmation message. Optional, but helps approval.">
        <input
          className="input"
          autoComplete="off"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </Field>

      <Field label="Note (optional)">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      {error && <Notice tone="red">{error}</Notice>}
      <Button type="submit" disabled={Boolean(busy)}>
        {busy || submitLabel}
      </Button>
    </form>
  );
}
