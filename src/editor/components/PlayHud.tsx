/** Playtest overlay (messages, position) and keyboard controls. */
import { useEffect } from "react";
import { ladderSide } from "../../core";
import { restartPlaytest, stopPlaytest } from "../playtest";
import { useEditor } from "../store";

export function usePlayKeys(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const rt = () => useEditor.getState().playtest?.runtime;
    const map: Record<string, () => void> = {
      w: () => rt()?.move("forward"), arrowup: () => rt()?.move("forward"),
      s: () => rt()?.move("back"), arrowdown: () => rt()?.move("back"),
      a: () => rt()?.move("left"), d: () => rt()?.move("right"),
      q: () => rt()?.turn("left"), arrowleft: () => rt()?.turn("left"),
      e: () => rt()?.turn("right"), arrowright: () => rt()?.turn("right"),
      " ": () => rt()?.use(), f: () => rt()?.use(), enter: () => rt()?.use(),
      escape: stopPlaytest,
      r: restartPlaytest,
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const fn = map[e.key.toLowerCase()];
      if (!fn) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      fn();
    };
    // capture phase so editor shortcuts (S, D, E…) don't also fire
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active]);
}

export function PlayHud() {
  useEditor((s) => s.playTick);
  const pt = useEditor((s) => s.playtest);
  if (!pt) return null;
  const rt = pt.runtime;
  const st = rt.state;
  const recent = st.log.slice(-6);
  const levelName = rt.map.levels.find((l) => l.z === st.player.pos.z)?.name;
  const up = rt.ladder("up"), down = rt.ladder("down");
  const wall = up ? ladderSide(rt.map, st.player.pos) : null;
  return (
    <>
      <div className="hud-top">
        <span className="compass" aria-label={`Facing ${st.player.facing}`}>{{ north: "N", east: "E", south: "S", west: "W" }[st.player.facing]}</span>
        <span>({st.player.pos.x}, {st.player.pos.y}) · level {st.player.pos.z}{levelName ? ` · ${levelName}` : ""}</span>
      </div>
      {(up || down) && (
        <div className="hud-hint" role="status">
          {up
            ? <>A ladder leads up. <b>Space</b> climbs{wall ? <>, or walk forward into the {wall} wall</> : ""}.</>
            : <>A ladder leads down. <b>Space</b> climbs down, or step back into a wall.</>}
        </div>
      )}
      <div className="hud-log" aria-live="polite">
        {recent.map((l, i) => (
          <p key={st.log.length - recent.length + i} className={l.kind} style={{ opacity: 0.45 + (0.55 * (i + 1)) / recent.length }}>{l.text}</p>
        ))}
      </div>
      <div className="hud-keys">
        <b>W/S</b> move · <b>A/D</b> strafe · <b>Q/E</b> turn · <b>Space</b> use · <b>R</b> restart · <b>Esc</b> back to editor
      </div>
    </>
  );
}
