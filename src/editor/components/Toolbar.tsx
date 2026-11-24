import type { ReactElement } from "react";
import type { ToolId } from "../store";
import { useEditor } from "../store";
import { TOOLS } from "../tools";

const ICONS: Record<ToolId, ReactElement> = {
  select: <path d="M5 3l12 9-5 1 3 6-2 1-3-6-4 4z" />,
  room: <><rect x="4" y="4" width="16" height="16" rx="1" fill="none" strokeWidth="2" /><path d="M4 12h16M12 4v16" strokeWidth="1" opacity=".5" fill="none" /></>,
  paint: <path d="M14 3l7 7-9 9H5v-7zM4 21h16" fill="none" strokeWidth="2" />,
  erase: <path d="M16 3l5 5-11 11H5l-2-2zM9 9l6 6M12 21h9" fill="none" strokeWidth="2" />,
  edge: <><rect x="4" y="4" width="16" height="16" fill="none" strokeWidth="1" opacity=".5" /><path d="M20 4v16" strokeWidth="4" /></>,
  material: <><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" opacity=".7" /><circle cx="12" cy="16" r="3" opacity=".45" /></>,
  height: <path d="M4 20h16M7 20v-6h4v6M13 20V8h4v12M15 3v3M13 5l2-2 2 2" fill="none" strokeWidth="2" />,
  ramp: <path d="M3 20h18M5 20v-3h4v-3h4v-3h4V8h4v12" fill="none" strokeWidth="2" />,
  vertical: <><rect x="5" y="9" width="14" height="10" fill="none" strokeWidth="2" /><path d="M12 2v9M9 5l3-3 3 3" fill="none" strokeWidth="2" /></>,
  prop: <><path d="M12 20V9" fill="none" strokeWidth="2.5" /><circle cx="12" cy="6" r="3.5" /><path d="M6 21h12" fill="none" strokeWidth="2" /></>,
  start: <path d="M5 4l15 8-15 8 4-8z" />,
};

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  return (
    <nav className="toolbar" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool${tool === t.id ? " active" : ""}`}
          title={`${t.name} (${t.key})\n${t.hint}`}
          aria-label={t.name}
          aria-pressed={tool === t.id}
          onClick={() => setTool(t.id)}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" stroke="currentColor" strokeLinejoin="round">{ICONS[t.id]}</svg>
          <span className="key">{t.key}</span>
        </button>
      ))}
    </nav>
  );
}
