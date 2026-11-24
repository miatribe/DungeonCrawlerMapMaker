/** Strip above the viewport: 2D / 3D / Playtest switch and per-mode options. */
import { startPlaytest, startPlaytestHere, stopPlaytest } from "../playtest";
import { useEditor } from "../store";

export function ViewHeader() {
  const mode = useEditor((s) => s.viewMode);
  const cutaway = useEditor((s) => s.cutaway);
  const level = useEditor((s) => s.level);
  const set = useEditor((s) => s.set);
  const go = (m: "2d" | "3d") => { if (mode === "play") stopPlaytest(); set({ viewMode: m }); };
  return (
    <div className="view-header">
      <div className="segmented mode-switch" role="tablist" aria-label="View">
        <button role="tab" aria-selected={mode === "2d"} className={mode === "2d" ? "active" : ""} onClick={() => go("2d")} title="Top-down editor (F6 toggles 2D/3D)">2D</button>
        <button role="tab" aria-selected={mode === "3d"} className={mode === "3d" ? "active" : ""} onClick={() => go("3d")} title="3D overview (F6 toggles 2D/3D)">3D</button>
        <button role="tab" aria-selected={mode === "play"} className={mode === "play" ? "active" : ""} onClick={() => (mode === "play" ? stopPlaytest() : startPlaytest())} title="Walk the map from the start (F5). Shift+F5 starts at the selected cell.">▶ Playtest</button>
      </div>
      {mode === "3d" && (
        <label className="check-row inline-check">
          <input type="checkbox" checked={cutaway} onChange={(e) => set({ cutaway: e.target.checked })} />
          <span>Hide levels above {level}</span>
        </label>
      )}
      {mode !== "play" && (
        <button className="btn small" onClick={startPlaytestHere} title="Shift+F5">▶ From selected cell</button>
      )}
      {mode === "play" && <span className="muted small">Playtesting. Esc returns to the editor.</span>}
    </div>
  );
}
