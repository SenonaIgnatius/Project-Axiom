import { useRef, useState } from "react";
import { classifyPhoto } from "../lib/api.js";

export default function PhotoVerify({ projectId, reportedProgress }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  function pickFile(f) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setError(null);
  }

  async function runVerification() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await classifyPhoto({
        file,
        projectId,
        reportedProgressPct: reportedProgress,
        updateProject: false,
      });
      setResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <div
        className={`dropzone ${dragActive ? "active" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          pickFile(e.dataTransfer.files?.[0]);
        }}
      >
        {preview ? (
          <img
            src={preview}
            alt="Selected site photo"
            style={{ maxHeight: 180, borderRadius: 2, marginBottom: 10 }}
          />
        ) : null}
        <div style={{ fontSize: 13.5 }}>
          {file ? file.name : "Drop a site photo here, or click to choose one"}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
        <button className="btn" disabled={!file || busy} onClick={runVerification}>
          {busy ? "Running YOLOv8 classifier…" : "Verify against reported progress"}
        </button>
        {file && (
          <button
            className="btn secondary"
            onClick={() => {
              setFile(null);
              setPreview(null);
              setResult(null);
              setError(null);
            }}
          >
            Clear
          </button>
        )}
      </div>

      {error && <div className="error-note">{error}</div>}

      {result && (
        <div style={{ marginTop: 16 }}>
          <div className="result-line">
            <span>Classified as</span>
            <strong>{result.label}</strong>
          </div>
          <div className="result-line">
            <span>Model confidence</span>
            <span className="mono">{(result.confidence * 100).toFixed(1)}%</span>
          </div>
          <div className="result-line">
            <span>Verified completion estimate</span>
            <span className="mono">{result.photo_verified_estimate}%</span>
          </div>
          <div className="result-line">
            <span>Gap vs. reported progress</span>
            <span className="mono">{result.photo_gap} pts</span>
          </div>
          {result.heuristic_notes && (
            <div className="hero-label" style={{ marginTop: 10 }}>
              {result.heuristic_notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
