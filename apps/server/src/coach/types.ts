export type Skill = 'listening' | 'reading' | 'writing' | 'speaking';

export type ActionType = 'write-task2' | 'write-task1' | 'speak-part' | 'speak-full' | 'listening-test' | 'reading-test' | 'see-evidence' | 'review-deck';

export type Evidence = { attemptIds: string[]; mistakeIds?: string[]; lr?: { attemptId: string; n: number }[] };

export type SkillFacts = {
  skill: Skill;
  tests: number;
  band: number | null;
  range: [number, number] | null;
  trend: 'improving' | 'steady' | 'slipping' | 'calibrating';
  trendDelta: number | null;
  needMore: number;
  gap: number | null;
  series: { at: string; band: number }[];
};

export type Candidate = {
  id: string;
  skill: Skill;
  kind: string;
  count: number;
  tests: number;
  share: number;
  score: number;
  facts: Record<string, string | number>;
  evidence: Evidence;
  actions: ActionType[];
};

export type Swap = { id: string; skill: 'writing' | 'speaking'; from: string; to: string[]; count: number; source: 'mistake' | 'upgrade' | 'overused'; evidence: Evidence };

export type SpellGroup = { id: string; rule: 'double' | 'ending' | 'silent' | 'ie-ei' | 'plural' | 'other'; count: number; examples: { typed: string; correct: string }[]; evidence: Evidence };

export type CoachFacts = {
  version: 1;
  generatedFor: string;
  target: number | null;
  examDate: string | null;
  daysToExam: number | null;
  totalTests: number;
  skills: SkillFacts[];
  overall: { band: number; range: [number, number] } | null;
  candidates: Candidate[];
  win: Candidate | null;
  swaps: Swap[];
  spelling: SpellGroup[];
  patterns: Record<Skill, Candidate[]>;
  timing: Record<string, number>;
  reviewDue: number;
  weekStats: { tests: number; minutes: number; days: number; prev: { tests: number; minutes: number; days: number } };
};

export type CoachWords = {
  summary: string;
  focus: { candidateId: string; title: string; why: string; action: ActionType; label: string }[];
  win: string | null;
  cheat: { candidateId: string; text: string }[];
  plan: { day: string; text: string; action: ActionType }[];
};
