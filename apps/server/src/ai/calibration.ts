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

/** Fixed maps for models without an active record (docs/scoring-validation.md §7): the raw scorer compresses the scale towards the pool mean, so the
 *  slope is above 1. The map is part of what the app serves, but the model stays "unvalidated" (calibrated: false, q = 1) because the record's CV gate
 *  is not met. Fitted by `pnpm eval:scoring --split calib --fit` (lambda 1) on the current promptHash: refit and paste when the prompt or model changes. */
export const DEFAULT_MAPS: Record<string, { slope: number; intercept: number; mLo: number; mHi: number }> = {
  'openai/gpt-6-luna': { slope: 1.09, intercept: 0.11, mLo: 4.08, mHi: 7.42 }, // fitted 2026-10-01 on promptHash 74dd9986267aa369 (64 calibration scripts, mean/SD equating)
};

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
export function asCalibration(key: string, record?: Pick<CalibrationRecord, 'slope' | 'intercept' | 'mLo' | 'mHi' | 'q90'> & Partial<CalibrationRecord>, model?: string): Calibration {
  if (!record) {
    const d = model ? DEFAULT_MAPS[model] : undefined;
    return { key, calibrated: false, q: UNCALIBRATED_Q, map: d ? (m) => applyCalibration(d, m) : (m) => m };
  }
  const map = { slope: record.slope, intercept: record.intercept, mLo: record.mLo ?? -Infinity, mHi: record.mHi ?? Infinity };
  return { key, calibrated: true, q: record.q90, map: (m) => applyCalibration(map, m), record: record as CalibrationRecord };
}

export async function calibrationFor(key: string, model?: string): Promise<Calibration> {
  return asCalibration(key, await getCalibration(key), model);
}
