// Per-(model, promptHash, effort, K) calibration lookup (docs/scoring-research.md §2.4, §6 P1 item 11). Records are fitted and written by
// scripts/eval-scoring.ts --fit; only an `active` record (it passed the CV gate) is applied. No record: identity map with q = 1 and the
// "uncalibrated" label. We never borrow another model's offset: numerical bias is model-specific.
import { createHash } from 'node:crypto';
import { applyCalibration, applyKnotMap, type KnotMap } from '@ielts/core';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { scoringCalibrations } from '../db/schema';

export type CalibrationRecord = typeof scoringCalibrations.$inferSelect;
/** `gd`: grammar errors per 100 words from the feedback call, used by knot maps (DEFAULT_MAPS); linear records ignore it. */
export type Calibration = { key: string; calibrated: boolean; q: number; map: (m: number, gd?: number) => number; record?: CalibrationRecord };

/** Half-width of the displayed range for a model without a validated record. */
export const UNCALIBRATED_Q = 1;
export const UNCALIBRATED_LABEL = 'Estimated with an unvalidated model: scores may be off by about a band.';

/** Fixed maps for models without an active record (docs/scoring-validation.md §7, §8): the raw scorer compresses the scale towards the pool mean and cannot reach
 *  the floor or the top, so the map is piecewise linear on the raw mean plus the feedback call's grammar error density (applyKnotMap). It is part of what the app serves,
 *  but the model stays "unvalidated" (calibrated: false, q = 1) because the CV gate is not met. Fitted by
 *  `pnpm eval:scoring --split calib --fit --with-anchors --with-ceilings` on the current promptHash and feedback prompt: refit and paste when either changes. */
export const DEFAULT_MAPS: Record<string, KnotMap> = {
  'openai/gpt-6-luna': { w: -0.16, gd0: 4.31, knots: [[3.5, 4.34], [4.5, 5.34], [7.5, 7.65], [8.5, 8.65]] },
  // Jev writing scorer (writing.ts jevScoreWriting, request JEV_WRITING_HASH): fitted 2026-10-07 on the 70 calibration scripts (apps/server/.eval/jev/fit-writing-map.mts);
  // leave-one-prompt-out CV MAE 0.53 / QWK 0.78; frozen TEST MAE 0.52 / QWK 0.80 (luna 0.45 / 0.85).
  'typesafe/jev-1.13': { w: -0.22, gd0: 4.39, knots: [[3.5, 4.39], [4.5, 5.39], [7.5, 7.42], [8.5, 8.1]] }, // fitted 2026-10-01 on promptHash c2c869d31a9fcf39 (98 calibration scripts: 64 gold + 22 anchors + 6 model answers at 8.5 + 6 authored floors; leave-one-prompt-out CV: MAE 0.52, bias >=7 -0.37, <=5 +0.04)
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
    return { key, calibrated: false, q: UNCALIBRATED_Q, map: d ? (m, gd) => applyKnotMap(d, m, gd) : (m) => m };
  }
  const map = { slope: record.slope, intercept: record.intercept, mLo: record.mLo ?? -Infinity, mHi: record.mHi ?? Infinity };
  return { key, calibrated: true, q: record.q90, map: (m) => applyCalibration(map, m), record: record as CalibrationRecord };
}

export async function calibrationFor(key: string, model?: string): Promise<Calibration> {
  return asCalibration(key, await getCalibration(key), model);
}
