import { useEffect, useMemo, useRef, useState } from "react";
import { listExporters } from "../../exporters";
import { exportNow } from "../actions";
import { useEditor } from "../store";

export function ExportDialog() {
  const open = useEditor((s) => s.exportOpen);
  const set = useEditor((s) => s.set);
  const problems = useEditor((s) => s.problems);
  const exporters = useMemo(() => listExporters(), []);
  const [id, setId] = useState(exporters[0]?.id ?? "json");
  const exporter = exporters.find((e) => e.id === id)!;
  const [options, setOptions] = useState<Record<string, unknown>>({ ...exporter.defaultOptions });
  const dlg = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dlg.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => setOptions({ ...exporter.defaultOptions }), [exporter]);

  const errors = problems.filter((p) => p.severity === "error");
  const warnings = problems.filter((p) => p.severity === "warning");

  return (
    <dialog ref={dlg} className="dialog" onClose={() => set({ exportOpen: false })} aria-labelledby="export-title">
      <h2 id="export-title">Export map</h2>
      <label className="row">
        <span className="row-label">Format</span>
        <span className="row-field">
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {exporters.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </span>
      </label>
      {exporter.optionsSchema?.map((o) => (
        <label key={o.name} className="check-row">
          <input type="checkbox" checked={!!options[o.name]} onChange={(e) => setOptions({ ...options, [o.name]: e.target.checked })} />
          <span>{o.description ?? o.name}</span>
        </label>
      ))}
      {errors.length > 0 ? (
        <div className="callout error">
          <strong>{errors.length} error{errors.length > 1 ? "s" : ""} must be fixed before exporting:</strong>
          <ul>{errors.slice(0, 5).map((p, i) => <li key={i}>{p.message}</li>)}</ul>
          {errors.length > 5 && <p className="small">…and {errors.length - 5} more in the Problems tab.</p>}
        </div>
      ) : warnings.length > 0 ? (
        <div className="callout warning">{warnings.length} warning{warnings.length > 1 ? "s" : ""} (export allowed). See the Problems tab.</div>
      ) : (
        <div className="callout ok">No problems found.</div>
      )}
      <div className="dialog-actions">
        <button className="btn" onClick={() => set({ exportOpen: false })}>Cancel</button>
        <button className="btn primary" disabled={errors.length > 0} onClick={() => { if (exportNow(id, options)) set({ exportOpen: false }); }}>
          Export {exporter.fileExtension}
        </button>
      </div>
    </dialog>
  );
}
