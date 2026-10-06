import type { ReactNode } from 'react';

/** One filled Button (full width on phone) plus up to two text links. */
export function ActionRow({ primary, links, note }: { primary: ReactNode; links?: ReactNode[]; note?: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 type-body">
        <div className="max-sm:w-full max-sm:[&>*]:w-full">{primary}</div>
        {links?.slice(0, 2).map((l, i) => <div key={i}>{l}</div>)}
      </div>
      {note && <p className="type-caption max-w-[68ch]">{note}</p>}
    </div>
  );
}
