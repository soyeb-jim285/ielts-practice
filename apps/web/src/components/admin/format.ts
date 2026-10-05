const TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short' });

/** "5 Oct, 14:30" in Asia/Dhaka, where the owner's "today" is. */
export const dhakaTime = (iso: string) => TIME.format(new Date(iso));
/** "YYYY-MM-DD" bucket (already a Dhaka day) as "5 Oct". */
export const dhakaDay = (ymd: string) => DAY.format(new Date(`${ymd}T12:00:00+06:00`));

/** Full email for an account, "Guest abc123" for a guest (server sends '' for their email). */
export const userLabel = (u: { id: string; email: string | null }) => u.email || `Guest ${u.id.slice(0, 6)}`;

export const band = (n: number | null | undefined) => (n == null ? '-' : n.toFixed(1));
export const percent = (n: number) => `${Math.round(n * 100)}%`;
export const usd = (n: number | null) => (n == null ? '-' : `$${n.toFixed(2)}`);
export const num = (n: number | null) => (n == null ? '-' : n.toLocaleString('en-GB'));
