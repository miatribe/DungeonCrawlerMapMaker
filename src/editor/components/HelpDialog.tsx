/** Keyboard shortcuts and a quick guide (F1 or ?). */
import { useEffect, useRef } from "react";
import { APP_VERSION } from "../../core";
import { useEditor } from "../store";
import { TOOLS } from "../tools";

const REPO = "https://github.com/miatribe/DungeonCrawlerMapMaker";

const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Files & editing",
    rows: [
      ["Ctrl+S / Ctrl+Shift+S", "Save / Save as (.dcmm)"],
      ["Ctrl+O", "Open a project"],
      ["Ctrl+E", "Export"],
      ["Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y", "Undo / Redo"],
      ["Delete", "Delete the selection"],
      ["Ctrl+A", "Select all cells on the level"],
      ["Esc", "Clear selection · cancel picking"],
    ],
  },
  {
    title: "View",
    rows: [
      ["PgUp / PgDn", "Level up / down"],
      ["Home", "Fit the level (2D)"],
      ["Middle-drag, Space+drag", "Pan (2D)"],
      ["Wheel", "Zoom"],
      ["F6", "Toggle 2D / 3D"],
      ["L", "Show all logic links"],
      ["= / -", "Raise / lower the floor of the selection or hovered cell"],
      ["Shift+= / Shift+-", "Raise / lower the ceiling"],
    ],
  },
  {
    title: "Playtest",
    rows: [
      ["F5 / Shift+F5", "Play from the start / from the selected cell"],
      ["W / S", "Move forward / back"],
      ["A / D", "Strafe left / right"],
      ["Q / E (or ← / →)", "Turn"],
      ["Space / F / Enter", "Use what's in front of you"],
      ["R", "Restart"],
      ["Esc", "Back to the editor"],
    ],
  },
];

export function HelpDialog() {
  const open = useEditor((s) => s.helpOpen);
  const set = useEditor((s) => s.set);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dlg.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={dlg} className="dialog help" onClose={() => set({ helpOpen: false })} aria-labelledby="help-title">
      <div className="help-head">
        <h2 id="help-title">DCMM help</h2>
        <span className="muted small">v{APP_VERSION}</span>
        <span className="spacer" />
        <button className="btn small" onClick={() => set({ helpOpen: false })}>Close</button>
      </div>
      <div className="help-grid">
        <section>
          <h3>Tools</h3>
          <table className="keys">
            <tbody>
              {TOOLS.map((t) => (
                <tr key={t.id}><td><kbd>{t.key}</kbd></td><td><b>{t.name}</b>: {t.hint}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          {SECTIONS.map((s) => (
            <div key={s.title}>
              <h3>{s.title}</h3>
              <table className="keys">
                <tbody>
                  {s.rows.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      </div>
      <h3>How a map comes together</h3>
      <ol className="small">
        <li><b>Rooms:</b> drag rooms with Room (R), then put doors and gates on cell edges with Connections (D).</li>
        <li><b>Heights:</b> shape them with Height (H), Ramp/Stairs (S) and Vertical connections (U). Switch levels with PgUp/PgDn.</li>
        <li><b>Props:</b> place them with Props (P), and set the start with Start (T).</li>
        <li><b>Logic:</b> select something and give it a trigger in the Inspector, then build the event in the Events tab. Arrows on the map show what each trigger affects.</li>
        <li><b>Check and export:</b> check the Problems tab, walk the map with F5, then export JSON (Ctrl+E).</li>
      </ol>
      <p className="small">
        Export format for engine developers: <a href={`${REPO}/blob/master/docs/EXPORT_FORMAT.md`} target="_blank" rel="noreferrer">docs/EXPORT_FORMAT.md</a> ·
        full design: <a href={`${REPO}/blob/master/docs/SPEC.md`} target="_blank" rel="noreferrer">docs/SPEC.md</a>
      </p>
    </dialog>
  );
}
