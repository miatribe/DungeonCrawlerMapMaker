/** Sidebar during playtest: live state, custom condition toggles and the full log. */
import { copyStateToMap, restartPlaytest, stopPlaytest } from "../playtest";
import { useEditor } from "../store";

export function PlaytestPanel() {
  useEditor((s) => s.playTick);
  const pt = useEditor((s) => s.playtest);
  const customConds = useEditor((s) => s.customConds);
  const set = useEditor((s) => s.set);
  if (!pt) return null;
  const rt = pt.runtime;
  const st = rt.state;
  const map = rt.map;
  const edges = map.edges.filter((e) => map.connectionTypes[e.type]?.kind !== "opening");
  const customC = Object.entries(map.customTypes).filter(([, t]) => t.category === "condition");
  const changedEdge = (k: string, initial: string) => st.edges[k] !== initial;

  return (
    <div className="playtest-panel">
      <section className="panel">
        <header className="panel-head"><h2>Playtest</h2></header>
        <div className="panel-body">
          <div className="btn-group">
            <button className="btn small" onClick={restartPlaytest} title="R">Restart</button>
            <button className="btn small" onClick={stopPlaytest} title="Esc">Back to editor</button>
            <button className="btn small" onClick={copyStateToMap} title="Make the current states and flag values the map's starting values">Copy state to map</button>
          </div>
          <p className="muted small">The map isn't changed while you play. Everything below is live.</p>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head"><h2>Flags</h2></header>
        <div className="panel-body">
          {Object.keys(st.flags).length ? (
            <table className="grid-table compact"><tbody>
              {Object.entries(st.flags).map(([k, v]) => (
                <tr key={k} className={map.flags[k]?.initial !== v ? "changed" : ""}><td className="mono">{k}</td><td className="mono">{JSON.stringify(v)}</td></tr>
              ))}
            </tbody></table>
          ) : <p className="muted small">No flags.</p>}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head"><h2>Connections & props</h2></header>
        <div className="panel-body">
          <table className="grid-table compact"><tbody>
            {edges.map((e) => (
              <tr key={e.key} className={changedEdge(e.key, e.state) ? "changed" : ""}>
                <td className="mono">{e.id ?? e.key}</td>
                <td className="muted small">{map.connectionTypes[e.type]?.name ?? e.type}</td>
                <td className="mono">{st.edges[e.key]}</td>
              </tr>
            ))}
            {map.props.map((p) => (
              <tr key={p.id} className={st.props[p.id] !== p.state ? "changed" : ""}>
                <td className="mono">{p.id}</td>
                <td className="muted small">{map.propTypes[p.type]?.name ?? p.type}</td>
                <td className="mono">{st.props[p.id]}</td>
              </tr>
            ))}
            {!edges.length && !map.props.length && <tr><td className="muted small">Nothing stateful on this map.</td></tr>}
          </tbody></table>
        </div>
      </section>

      {customC.length > 0 && (
        <section className="panel">
          <header className="panel-head"><h2>Custom conditions</h2></header>
          <div className="panel-body">
            <p className="muted small">Your engine decides these. Choose what they return while testing.</p>
            {customC.map(([id, t]) => (
              <label key={id} className="check-row">
                <input type="checkbox" checked={customConds[id] ?? true} onChange={(e) => set({ customConds: { ...customConds, [id]: e.target.checked } })} />
                <span>{t.name} <span className="muted small mono">{id}</span> → {(customConds[id] ?? true) ? "true" : "false"}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <header className="panel-head"><h2>Events fired</h2></header>
        <div className="panel-body">
          {st.fired.length ? <p className="mono small">{st.fired.join(", ")}</p> : <p className="muted small">None yet.</p>}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head"><h2>Log</h2></header>
        <div className="panel-body play-log">
          {[...st.log].reverse().map((l, i) => <p key={st.log.length - i} className={l.kind}>{l.text}</p>)}
        </div>
      </section>
    </div>
  );
}
