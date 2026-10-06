import { Link } from '@tanstack/react-router';
import { BookOpen, Headphones, Mic, PenLine } from 'lucide-react';
import { listStyles, RowChevron, RowIcon, rowStyles, RowText } from '@/components/bank/ListRow';
import { Section } from '@/components/result';
import { quotaText, useQuota } from '@/lib/community';

const linkStyles = 'inline-flex min-h-11 items-center font-medium text-accent-text underline underline-offset-4 hover:no-underline';

/** Four skills, equal weight, one row each (bands live in the picture above, so no numerals here). One quiet line of the other places to go. */
export function PractiseList({ liveReady }: { liveReady: boolean }) {
  const { data: q } = useQuota();
  const left = (k: 'speaking' | 'writing') => {
    if (!q) return null;
    const t = quotaText(q[k], q.tier);
    return <span className={`type-caption type-num ml-2 font-normal ${t.warn ? 'text-warn-text' : ''}`}>{t.text}</span>;
  };
  return (
    <Section title="Practise" id="practise">
      <ul className={`${listStyles} stagger`}>
        <li>
          <Link to="/listening" className={rowStyles}>
            <RowIcon><Headphones /></RowIcon>
            <RowText title="Listening" meta="Unlimited free practice tests, 40 questions, or one part at a time" />
            <RowChevron />
          </Link>
        </li>
        <li>
          <Link to="/reading" className={rowStyles}>
            <RowIcon><BookOpen /></RowIcon>
            <RowText title="Reading" meta="Unlimited free practice tests, 40 questions, or one passage" />
            <RowChevron />
          </Link>
        </li>
        <li>
          <Link to="/writing" className={rowStyles}>
            <RowIcon><PenLine /></RowIcon>
            <RowText title={<>Writing{left('writing')}</>} meta={`Task 1 and Task 2, feedback by criterion. A Task 2 essay is 40 min, at least 250 words`} />
            <RowChevron />
          </Link>
        </li>
        <li>
          <Link to="/speaking" className={rowStyles}>
            <RowIcon><Mic /></RowIcon>
            <RowText title={<>Speaking{left('speaking')}</>} meta={`Full test 11-14 min, or one part. Live examiner: ${liveReady ? 'a spoken conversation with an AI examiner' : 'needs your own API key, added in Settings'}`} />
            <RowChevron />
          </Link>
        </li>
      </ul>
      <p className="type-body flex flex-wrap gap-x-6">
        <Link to="/bank" className={linkStyles}>Prompt bank</Link>
        <Link to="/mistakes" className={linkStyles}>Mistakes</Link>
        <Link to="/review" className={linkStyles}>Review deck</Link>
        <Link to="/history" className={linkStyles}>All attempts</Link>
      </p>
    </Section>
  );
}
