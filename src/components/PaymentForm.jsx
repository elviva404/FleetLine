import { useEffect, useRef, useState } from "react";
import { formatMoney, todayAccra } from "../lib/format.js";
import { compressImage } from "../lib/images.js";
import { parseMomoText, pickBestTransaction } from "../lib/momo.js";
import { ocrSupported, readScreenshot } from "../lib/ocr.js";
import { uploadScreenshot } from "../lib/storage.js";
import { errorMessage } from "../lib/supabase.js";
import { Button, Field, Notice, Screenshot } from "../ui.jsx";

const BLANK_OCR = { ocr_amount: null, ocr_reference: null, ocr_receiver: null, ocr_source: null };

// Shared by the driver ("Log a payment") and the owner ("Record payment").
// onSubmit receives { amount, paid_on, reference, note, screenshot_path, ...ocr fields }.
export default function PaymentForm({ initial, defaultAmount, storageKey, onSubmit, submitLabel = "Submit payment" }) {
  const [amount, setAmount] = useState(initial ? String(initial.amount) : defaultAmount ? String(defaultAmount) : "");
  const [paidOn, setPaidOn] = useState(initial?.paid_on ?? todayAccra());
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [existingPath, setExistingPath] = useState(initial?.screenshot_path ?? null);
  const [image, setImage] = useState(null); // { blob, previewUrl }
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const [reading, setReading] = useState(null); // { label, progress }
  const [candidates, setCandidates] = useState([]);
  const [readNote, setReadNote] = useState({ tone: "", text: "" });
  const [filled, setFilled] = useState({});
  const [ocrData, setOcrData] = useState(BLANK_OCR);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const abortRef = useRef(null);

  useEffect(() => () => image && URL.revokeObjectURL(image.previewUrl), [image]);
  useEffect(() => () => abortRef.current?.abort(), []);

  function applyTransaction(transaction, source) {
    if (transaction.amount != null) setAmount(String(transaction.amount));
    if (transaction.reference) setReference(transaction.reference);
    if (transaction.paid_on) setPaidOn(transaction.paid_on);
    setFilled({
      amount: transaction.amount != null,
      reference: Boolean(transaction.reference),
      paidOn: Boolean(transaction.paid_on),
    });
    setOcrData({
      ocr_amount: transaction.amount,
      ocr_reference: transaction.reference,
      ocr_receiver: transaction.counterparty,
      ocr_source: source,
    });
    setCandidates([]);
    setReadNote({
      tone: "green",
      text: transaction.paid_on
        ? "Read from your message. Please check it below."
        : "Read from your message. Please check the details, including the date.",
    });
  }

  function handleParsed(transactions, source) {
    if (!transactions.length) {
      setReadNote({ tone: "amber", text: "Couldn't read it. Please type the details below." });
      return;
    }
    if (transactions.length === 1) {
      applyTransaction(transactions[0], source);
      return;
    }
    setCandidates(transactions.map((t) => ({ ...t, source })));
    const best = pickBestTransaction(transactions);
    setReadNote({
      tone: "amber",
      text: `Found ${transactions.length} payments. Tap the one you are logging${
        best ? ` (probably ${formatMoney(best.amount)})` : ""
      }.`,
    });
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setReadNote({ tone: "", text: "" });
    setCandidates([]);
    setBusy("Preparing photo…");

    let blob;
    try {
      blob = await compressImage(file);
      setImage({ blob, previewUrl: URL.createObjectURL(blob) });
      setExistingPath(null);
    } catch (err) {
      setError(errorMessage(err));
      setBusy("");
      return;
    }
    setBusy("");

    if (!ocrSupported()) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setReading({ label: "Reading your screenshot…", progress: 0 });
    try {
      const { transactions } = await readScreenshot(file, {
        signal: controller.signal,
        onProgress: ({ stage, progress }) => {
          const label =
            stage === "download"
              ? "Getting ready (first time only)…"
              : stage === "preparing"
                ? "Preparing screenshot…"
                : "Reading your screenshot…";
          setReading({ label, progress });
        },
      });
      handleParsed(transactions, "screenshot");
    } catch (err) {
      setReadNote({
        tone: "amber",
        text: /cancel/i.test(err.message) ? "" : "Couldn't read the screenshot. Please type the details below.",
      });
    } finally {
      setReading(null);
      abortRef.current = null;
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
        ...ocrData,
      });
    } catch (err) {
      setError(errorMessage(err));
      setBusy("");
    }
  }

  const hasPhoto = Boolean(image || existingPath);
  const inputClass = (key) => `input${filled[key] ? " input-read" : ""}`;

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

        {reading && (
          <div className="reading">
            <div className="reading-row">
              <span className="spinner spinner-sm" aria-hidden="true" />
              <span>{reading.label}</span>
              <button type="button" className="btn btn-link" onClick={() => abortRef.current?.abort()}>
                Skip
              </button>
            </div>
            <div className="progress">
              <div className="progress-fill" style={{ width: `${Math.round((reading.progress || 0) * 100)}%` }} />
            </div>
          </div>
        )}

        {readNote.text && <Notice tone={readNote.tone}>{readNote.text}</Notice>}

        {candidates.length > 0 && (
          <ul className="ledger candidates">
            {candidates.map((t, index) => (
              <li key={index} className="ledger-row clickable" onClick={() => applyTransaction(t, t.source)}>
                <div className="ledger-main">
                  <div className="ledger-title">{formatMoney(t.amount ?? 0)}</div>
                  <div className="ledger-meta">
                    {[t.direction === "sent" ? `to ${t.counterparty ?? "someone"}` : `from ${t.counterparty ?? "someone"}`,
                      t.reference && `ID ${t.reference}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="ledger-side">
                  <span className="btn btn-ghost btn-sm">Use this</span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {!pasting ? (
          <button type="button" className="btn btn-link" onClick={() => setPasting(true)}>
            Or paste the MoMo message instead
          </button>
        ) : (
          <div className="stack">
            <Field label="Paste the MoMo message" hint="Copy the confirmation message from your phone and paste it here.">
              <textarea className="input" rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} />
            </Field>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCandidates([]);
                handleParsed(parseMomoText(pasted), "pasted");
              }}
            >
              Read message
            </Button>
          </div>
        )}
      </div>

      <div className="form-grid">
        <Field label="Amount (GH₵)" hint={filled.amount ? "Read from your message — check it" : undefined}>
          <input
            className={inputClass("amount")}
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            required
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setFilled({ ...filled, amount: false });
            }}
          />
        </Field>
        <Field label="Date paid" hint={filled.paidOn ? "Read from your message — check it" : undefined}>
          <input
            className={inputClass("paidOn")}
            type="date"
            required
            max={todayAccra()}
            value={paidOn}
            onChange={(e) => {
              setPaidOn(e.target.value);
              setFilled({ ...filled, paidOn: false });
            }}
          />
        </Field>
      </div>

      <Field
        label="Transaction ID"
        hint={filled.reference ? "Read from your message — check it" : "From the MoMo confirmation message. Optional, but helps approval."}
      >
        <input
          className={inputClass("reference")}
          autoComplete="off"
          value={reference}
          onChange={(e) => {
            setReference(e.target.value);
            setFilled({ ...filled, reference: false });
          }}
        />
      </Field>

      <Field label="Note (optional)">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      {error && <Notice tone="red">{error}</Notice>}
      <Button type="submit" disabled={Boolean(busy) || Boolean(reading)}>
        {busy || submitLabel}
      </Button>
    </form>
  );
}
