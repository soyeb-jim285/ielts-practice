/** Paid plan prices in BDT (one-time payment, no auto-renewal). The server charges these; the pricing and checkout pages show them. */
export const PAID_PLANS = {
  month: { label: '1 month', days: 30, bdt: 499 },
  quarter: { label: '3 months', days: 90, bdt: 1199 },
} as const;
export type PaidPlan = keyof typeof PAID_PLANS;

/** "৳1,199" */
export const bdt = (n: number) => `৳${n.toLocaleString('en-IN')}`;
