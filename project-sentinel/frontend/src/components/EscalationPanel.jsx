import { useState } from "react";
import { escalateProject } from "../lib/api.js";

export default function EscalationPanel({ projectId, flagged }) {
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function draft() {
    setBusy(true);
    setError(null);
    try {
      setNotice(await escalateProject(projectId));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <p className="muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
        {flagged
          ? "This project is flagged. Draft the clarification request Sentinel would send to the implementing agency."
          : "Not currently flagged — you can still draft a clarification request."}
      </p>
      <button className="btn" onClick={draft} disabled={busy}>
        {busy ? "Drafting…" : notice ? "Draft again" : "Draft escalation notice"}
      </button>
      {error && <div className="error-note" style={{ marginTop: 12 }}>{error}</div>}

      {notice && (
        <div className="notice">
          <div className="notice-head">
            <span className="tag-simulated">Simulated · not sent</span>
            <span className="mono muted">{notice.reference} · {notice.drafted_at}</span>
          </div>
          <dl className="notice-meta">
            <dt>To</dt><dd>{notice.to}</dd>
            <dt>Cc</dt><dd>{notice.cc}</dd>
            <dt>Subject</dt><dd>{notice.subject}</dd>
          </dl>
          <ul className="notice-findings">
            {notice.findings.map((f) => <li key={f}>{f}</li>)}
          </ul>
          <p style={{ fontSize: 13.5 }}>{notice.requested_action}</p>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>{notice.note}</p>
        </div>
      )}
    </div>
  );
}
