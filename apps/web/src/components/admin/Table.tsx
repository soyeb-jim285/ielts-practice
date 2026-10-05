import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Col<T> = { head: string; cell: (r: T) => ReactNode; className?: string };

/**
 * A real table from md up; below md every row is a stacked card (first column is the title, the rest are label/value pairs).
 * Rendering both keeps the markup simple; CSS shows one.
 */
export function DataTable<T>({ rows, cols, rowKey, label, dense }: { rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; label: string; dense?: boolean }) {
  const [first, ...rest] = cols;
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="border-b border-line">
              {cols.map((c) => (
                <th key={c.head} scope="col" className={cn('type-caption px-3 py-2 font-medium first:pl-0', c.className)}>
                  {c.head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={rowKey(r)}>
                {cols.map((c) => (
                  <td key={c.head} className={cn('px-3 align-top first:pl-0', dense ? 'py-2' : 'py-3', c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line border-y border-line md:hidden" aria-label={label}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="py-4">
            <div className="min-w-0 font-medium break-words">{first!.cell(r)}</div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {rest.map((c) => (
                <div key={c.head} className="contents">
                  <dt className="type-caption">{c.head}</dt>
                  <dd className="min-w-0 break-words">{c.cell(r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
