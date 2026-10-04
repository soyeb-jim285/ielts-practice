import { useState } from 'react';
import { Segmented } from '@/components/ui';
import { lsGet, lsSet } from '@/lib/lr';
import { useMe } from '@/lib/query';

type Choice = 'any' | 'cambridge' | 'generated';

/** Which bank random tests draw from, remembered per browser and skill. Only Cambridge-allowlisted accounts get a choice; everyone else gets `source` undefined (= the server's default, any visible prompt). */
export function useQuestionSource(skill: 'speaking' | 'writing') {
  const access = useMe().data?.cambridgeAccess ?? false;
  const key = `question-source:${skill}`;
  const [choice, setChoice] = useState<Choice>(() => {
    const v = lsGet<Choice>(key, 'any');
    return v === 'cambridge' || v === 'generated' ? v : 'any';
  });
  const set = (v: Choice) => {
    setChoice(v);
    lsSet(key, v);
  };
  return { access, choice, set, source: access && choice !== 'any' ? choice : undefined };
}

/** Compact "Questions" choice for a hub's header. Renders nothing without Cambridge access. */
export function QuestionSourcePicker({ q, cambridgeNote }: { q: ReturnType<typeof useQuestionSource>; cambridgeNote?: string }) {
  if (!q.access) return null;
  return (
    <div className="flex flex-col gap-1.5 max-sm:w-full sm:items-end">
      <div className="flex items-center gap-3 max-sm:w-full">
        <span className="type-caption" aria-hidden>
          Questions
        </span>
        <Segmented
          label="Questions"
          size="sm"
          className="max-sm:flex-1"
          value={q.choice}
          onChange={q.set}
          options={[
            { value: 'any', label: 'Mixed' },
            { value: 'cambridge', label: 'Cambridge books' },
            { value: 'generated', label: 'Our own' },
          ]}
        />
      </div>
      {q.choice === 'cambridge' && cambridgeNote && <p className="type-caption max-w-[44ch] sm:text-right">{cambridgeNote}</p>}
    </div>
  );
}
