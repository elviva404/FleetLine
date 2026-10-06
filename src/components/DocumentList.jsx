import { useEffect, useState } from "react";
import { DOCUMENT_KINDS, EXPIRY_STATUS, documentUrl } from "../lib/documents.js";
import { formatDate } from "../lib/format.js";
import { Badge, Card, Empty } from "../ui.jsx";

export function DocumentRow({ document: doc, action }) {
  const status = EXPIRY_STATUS[doc.expiry_status ?? "none"];
  return (
    <li className="ledger-row">
      <div className="ledger-main stack" style={{ gap: 4 }}>
        <div>
          <div className="ledger-title">{doc.title}</div>
          <div className="ledger-meta">
            {DOCUMENT_KINDS[doc.kind] ?? doc.kind}
            {doc.expires_on ? ` · expires ${formatDate(doc.expires_on)}` : ""}
          </div>
        </div>
        <div className="actions">
          <OpenDocument path={doc.file_path} mimeType={doc.mime_type} />
          {action}
        </div>
      </div>
      <div className="ledger-side">
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
    </li>
  );
}

function OpenDocument({ path, mimeType }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    documentUrl(path)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (failed) return <span className="ledger-meta">File unavailable</span>;
  if (!url) return <span className="ledger-meta">Opening…</span>;

  return (
    <a className="btn btn-ghost btn-sm" href={url} target="_blank" rel="noreferrer">
      {mimeType === "application/pdf" ? "Open PDF" : "View"}
    </a>
  );
}

export function DocumentsCard({ documents, title = "Papers", aside, emptyText = "No papers uploaded." }) {
  return (
    <Card title={title} aside={aside}>
      {documents.length === 0 ? (
        <Empty>{emptyText}</Empty>
      ) : (
        <ul className="ledger">
          {documents.map((doc) => (
            <DocumentRow key={doc.id} document={doc} />
          ))}
        </ul>
      )}
    </Card>
  );
}
