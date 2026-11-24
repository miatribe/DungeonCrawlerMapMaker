/** Small form controls that commit on blur/Enter, so typing doesn't flood undo history. */
import { useEffect, useState, type ReactNode } from "react";

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="row" title={hint}>
      <span className="row-label">{label}</span>
      <span className="row-field">{children}</span>
    </label>
  );
}

export function TextField({ value, onCommit, placeholder, mono }: { value: string; onCommit: (v: string) => void; placeholder?: string; mono?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { if (v !== value) onCommit(v); };
  return (
    <input
      className={mono ? "mono" : undefined}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setV(value); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

export function NumberField({ value, onCommit, min, max, step = 1, placeholder }: { value: number | ""; onCommit: (v: number) => void; min?: number; max?: number; step?: number; placeholder?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Number(v);
    if (v.trim() === "" || !Number.isFinite(n)) { setV(String(value)); return; }
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (c !== value) onCommit(c);
    else setV(String(value));
  };
  return (
    <input
      type="number"
      value={v}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

export function Select<T extends string>({ value, options, onChange, empty }: { value: T | ""; options: { value: T; label: string }[]; onChange: (v: T | "") => void; empty?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T | "")}>
      {empty !== undefined && <option value="">{empty}</option>}
      {value !== "" && !options.some((o) => o.value === value) && <option value={value}>{value} (missing)</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ background: color }} />;
}
