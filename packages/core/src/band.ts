export function roundBand(x: number): number {
  const f = Math.floor(x + 1e-9), frac = x - f + 1e-9;
  return frac < 0.25 ? f : frac < 0.75 ? f + 0.5 : f + 1;
}

export function speakingOverall(c: { fc: number; lr: number; gra: number; p: number }) {
  const raw = (c.fc + c.lr + c.gra + c.p) / 4;
  return { raw, band: roundBand(raw) };
}

/** Mean of the four writing criteria, unrounded. */
export const taskBand = (c: { ta: number; cc: number; lr: number; gra: number }) => (c.ta + c.cc + c.lr + c.gra) / 4;

/** Task 2 counts double; a null task (not attempted) leaves the other alone. At least one must be non-null. */
export function writingOverall(t1: number | null, t2: number | null) {
  const raw = t1 == null ? t2! : t2 == null ? t1 : (t1 + 2 * t2) / 3;
  return { raw, band: roundBand(raw) };
}
