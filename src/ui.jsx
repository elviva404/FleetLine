import { useEffect, useRef, useState } from "react";
import { screenshotUrl } from "./lib/storage.js";

export function Masthead({ title, subtitle, action }) {
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <div>
          <div className="masthead-eyebrow">FleetLine</div>
          <h1 className="masthead-title">{title}</h1>
          {subtitle && <div className="masthead-subtitle">{subtitle}</div>}
        </div>
        {action}
      </div>
    </header>
  );
}

export function Page({ children }) {
  return <main className="page">{children}</main>;
}

export function Card({ title, aside, children, className = "" }) {
  return (
    <section className={`card ${className}`}>
      {(title || aside) && (
        <div className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = "primary", className = "", ...props }) {
  return <button className={`btn btn-${variant} ${className}`} {...props} />;
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Badge({ tone = "muted", children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Money({ value, className = "" }) {
  return <span className={`money ${className}`}>{value}</span>;
}

export function ProgressBar({ value }) {
  const pct = Math.max(0, Math.min(1, Number(value ?? 0))) * 100;
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Notice({ tone = "muted", children }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

export function Empty({ children }) {
  return <p className="empty">{children}</p>;
}

// Bottom sheet on phones, centred dialog on wider screens.
export function Sheet({ title, onClose, children }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="sheet-backdrop" onClick={() => onCloseRef.current()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 className="card-title">{title}</h2>
          <button type="button" className="sheet-close" onClick={() => onCloseRef.current()} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Screenshot({ path, large = false }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    screenshotUrl(path)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (failed) return <span className="ledger-meta">Screenshot unavailable</span>;

  return (
    <>
      <button
        type="button"
        className={`thumb ${large ? "thumb-large" : ""}`}
        onClick={() => setOpen(true)}
        disabled={!url}
        aria-label="View payment screenshot"
      >
        {url && <img src={url} alt="" />}
      </button>
      {open && (
        <div className="lightbox" role="dialog" aria-label="Payment screenshot" onClick={() => setOpen(false)}>
          <img src={url} alt="Payment screenshot" />
          <span className="lightbox-hint">Tap anywhere to close</span>
        </div>
      )}
    </>
  );
}

export function BackButton({ onClick, children = "Back" }) {
  return (
    <button type="button" className="back" onClick={onClick}>
      ‹ {children}
    </button>
  );
}

export function Loading({ label = "Loading…" }) {
  return (
    <div className="loading">
      <div className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
