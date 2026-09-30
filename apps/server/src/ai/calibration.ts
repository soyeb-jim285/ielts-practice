// Per-(model, promptHash, effort, K) calibration lookup (docs/scoring-research.md §2.4, §6 P1 item 11). Records are fitted and written by
// scripts/eval-scoring.ts --fit; only an `active` record (it passed the CV gate) is applied. No record: identity map with q = 1 and the
// "uncalibrated" label. We never borrow another model's offset: numerical bias is model-specific.
import { createHash } from 'node:crypto';
import { applyCalibration } from '@ielts/core';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { scoringCalibrations } from '../db/schema';

export type CalibrationRecord = typeof scoringCalibrations.$inferSelect;
export type Calibration = { key: string; calibrated: boolean; q: number; map: (m: number) => number; record?: CalibrationRecord };

/** Half-width of the displayed range for a model without a validated record. */
export const UNCALIBRATED_Q = 1;
export const UNCALIBRATED_LABEL = 'Estimated with an unvalidated model: scores may be off by about a band.';

export const calibrationKey = (modelId: string, promptHash: string, effort: string, k: number) =>
  createHash('sha256').update(`${modelId}|${promptHash}|${effort}|${k}`).digest('hex').slice(0, 32);

const cache = new Map<string, { at: number; record?: CalibrationRecord }>();
export const clearCalibrationCache = () => cache.clear();

/** The active record for a key, cached for 1 h. */
export async function getCalibration(key: string): Promise<CalibrationRecord | undefined> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.record;
  const [record] = await db.select().from(scoringCalibrations).where(and(eq(scoringCalibrations.key, key), eq(scoringCalibrations.active, true)));
  cache.set(key, { at: Date.now(), record });
  return record;
}

/** The map and conformal half-width for a record, or the uncalibrated fallback. Pure: the eval harness applies candidate records with it. */
export function asCalibration(key: string, record?: Pick<CalibrationRecord, 'slope' | 'intercept' | 'mLo' | 'mHi' | 'q90'> & Partial<CalibrationRecord>): Calibration {
  if (!record) return { key, calibrated: false, q: UNCALIBRATED_Q, map: (m) => m };
  const map = { slope: record.slope, intercept: record.intercept, mLo: record.mLo ?? -Infinity, mHi: record.mHi ?? Infinity };
  return { key, calibrated: true, q: record.q90, map: (m) => applyCalibration(map, m), record: record as CalibrationRecord };
}

export async function calibrationFor(key: string): Promise<Calibration> {
  return asCalibration(key, await getCalibration(key));
}
