/**
 * Project file migrations. Each entry upgrades a raw (unvalidated) project object from
 * version N to N+1. Add-only changes don't need a migration, only breaking ones do.
 */
import { FORMAT_VERSION } from "./schema";

type Raw = Record<string, any>;

export const MIGRATIONS: Record<number, (raw: Raw) => Raw> = {
  // 1: (raw) => ({ ...raw, formatVersion: 2, ... }),
};

export type MigrationResult =
  | { ok: true; raw: Raw; migratedFrom?: number }
  | { ok: false; reason: "newer" | "invalid"; message: string };

export function migrate(raw: Raw, migrations = MIGRATIONS, current = FORMAT_VERSION): MigrationResult {
  const v = raw.formatVersion;
  if (!Number.isInteger(v) || v < 1) return { ok: false, reason: "invalid", message: `formatVersion must be a positive integer (got ${JSON.stringify(v)})` };
  if (v > current) return { ok: false, reason: "newer", message: `This file was saved by a newer DCMM (format ${v}; this version reads up to ${current})` };
  let out = raw;
  for (let n = v; n < current; n++) {
    const step = migrations[n];
    if (!step) return { ok: false, reason: "invalid", message: `No migration from format ${n} to ${n + 1}` };
    out = step(out);
  }
  return v === current ? { ok: true, raw: out } : { ok: true, raw: out, migratedFrom: v };
}
