#!/usr/bin/env python3
"""Variety gate for the generated speaking bank (data/bank/speaking-*.json), measured against Cambridge IELTS 1-19.

Cambridge baseline (89 Part 1 sets / 390 q, 569 Part 3 q): ~0.34 distinct two-word openings per question in P1 and P3,
past-tense ("when you were younger") questions ~7% of P1 and early in a set, a third of P1 sets all present tense,
"Describe a time" on ~14% of cue cards. Our first bank was templated (P1 slot 4 = "Did you ... when you were younger?" in
29/70 sets; P3 0.12 openings/q), so this gate fails on those patterns.

Usage: python3 scripts/speaking-bank-check.py [--cambridge | --only p1|p2-a|p2-b|p3]
  --cambridge prints the same metrics for data/cambridge; --only gates one file's share of the bank (for parallel writers).
Exit 1 on any failure."""
import collections, glob, json, random, re, sys

BANK = 'data/bank'
fails: list[str] = []


def clean(q: str) -> str:
    return re.sub(r'\[.*?\]', '', q).strip()


def opening(q: str, n: int = 2) -> str:
    return ' '.join(re.sub(r"[^a-z' ]", '', clean(q).lower()).split()[:n])


def variety(qs: list[str], n: int = 380) -> float:
    """Distinct two-word openings per question in random samples of n questions: the raw ratio falls as a bank grows, so banks are compared at one size."""
    rnd = random.Random(0)
    k = min(n, len(qs))
    return sum(len({opening(q) for q in rnd.sample(qs, k)}) / k for _ in range(30)) / 30


def tense(q: str) -> str:
    l = clean(q).lower()
    if re.search(r"\b(when you were|as a child|younger|at school|used to|did you|were you|was it)\b", l):
        return 'past'
    if re.search(r"\b(would you|will you|in the future|like to|going to|might)\b", l):
        return 'future'
    return 'present'


def check(cond: bool, msg: str):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond:
        fails.append(msg)


def p1(sets: list[list[str]], gate: bool):
    qs = [q for s in sets for q in s]
    opens = collections.Counter(opening(q) for q in qs)
    t = collections.Counter(tense(q) for q in qs)
    last_past = sum(1 for s in sets if tense(s[-1]) == 'past')
    all_present = sum(1 for s in sets if all(tense(q) == 'present' for q in s))
    shapes = collections.Counter(tuple(opening(q, 1) for q in s) for s in sets)
    print(f'P1: {len(sets)} sets, {len(qs)} questions')
    if not gate:
        print(f'  openings/q {variety(qs):.2f}, past {t["past"]/len(qs):.0%}, last-slot past {last_past/len(sets):.0%}, all-present sets {all_present/len(sets):.0%}, "do you" {opens["do you"]/len(qs):.0%}')
        return
    check(all(3 <= len(s) <= 5 for s in sets), 'every set has 3-5 questions')
    check(variety(qs) >= 0.31, f'distinct openings per question {variety(qs):.2f} >= 0.31 (Cambridge 0.34)')
    check(opens['do you'] / len(qs) <= 0.30, f'"Do you" openings {opens["do you"]/len(qs):.0%} <= 30%')
    check(t['past'] / len(qs) <= 0.12, f'past-tense questions {t["past"]/len(qs):.0%} <= 12%')
    check(last_past / len(sets) <= 0.10, f'sets ending on a past-tense question {last_past/len(sets):.0%} <= 10%')
    check(all_present / len(sets) >= 0.25, f'sets entirely in the present {all_present/len(sets):.0%} >= 25%')
    check(shapes.most_common(1)[0][1] <= max(3, len(sets) // 15), f'most repeated first-word sequence used by {shapes.most_common(1)[0][1]} sets')


def p3(sets: list[list[str]], gate: bool):
    qs = [q for s in sets for q in s]
    opens = collections.Counter(opening(q) for q in qs)
    print(f'P3: {len(sets)} sets, {len(qs)} questions')
    if not gate:
        print(f'  openings/q {variety(qs):.2f}, top {opens.most_common(5)}')
        return
    check(variety(qs) >= 0.33, f'distinct openings per question {variety(qs):.2f} >= 0.33 (Cambridge 0.37)')
    for o, cap in [('do you', 0.20), ('why do', 0.08), ('what are', 0.07), ('how do', 0.07)]:
        check(opens[o] / len(qs) <= cap, f'"{o}" openings {opens[o]/len(qs):.0%} <= {cap:.0%}')
    flat = [s for s in sets if len({opening(q) for q in s}) < min(len(s), 3)]
    check(not flat, f'every set uses at least 3 different openings ({len(flat)} do not)')


def p2(cards: list[dict], gate: bool):
    titles = [c['title'] for c in cards]
    a_time = sum(1 for t in titles if t.lower().startswith('describe a time'))
    print(f'P2: {len(cards)} cards')
    if not gate:
        print(f'  "Describe a time" {a_time/len(cards):.0%}')
        return
    check(a_time / len(cards) <= 0.15, f'"Describe a time" cards {a_time/len(cards):.0%} <= 15%')
    check(all(3 <= len(c['bullets']) <= 4 for c in cards), 'every card has 3-4 bullets')
    check(all(c.get('explain', '').lower().startswith('and explain') for c in cards), 'every card ends "and explain ..."')


def dupes(all_qs: list[str]):
    c = collections.Counter(clean(q).lower() for q in all_qs)
    d = [q for q, n in c.items() if n > 1]
    check(not d, f'no question repeated across the bank ({len(d)} repeated{": " + "; ".join(d[:3]) if d else ""})')


if '--cambridge' in sys.argv:
    s1, s3 = [], []
    for f in glob.glob('data/cambridge/C*.json'):
        for t in json.load(open(f))['tests']:
            sp = t.get('speaking') or {}
            s1 += [b['questions'] for b in sp.get('p1') or []]
            s3 += [b['questions'] for b in sp.get('p3') or []]
    p1(s1, False)
    p3(s3, False)
    sys.exit(0)

only = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
use = lambda name: only in (None, name)
b1 = json.load(open(f'{BANK}/speaking-p1.json')) if use('p1') else []
cards = (json.load(open(f'{BANK}/speaking-p2-a.json')) if use('p2-a') else []) + (json.load(open(f'{BANK}/speaking-p2-b.json')) if use('p2-b') else [])
b3 = json.load(open(f'{BANK}/speaking-p3.json')) if use('p3') else []
topic_sets = [s['questions'] for s in b1 if not s.get('frame')]
p3_sets = [c['p3'] for c in cards] + [s['questions'] for s in b3]
if topic_sets:
    p1(topic_sets, True)
if cards:
    p2(cards, True)
if p3_sets:
    p3(p3_sets, True)
dupes([q for s in b1 for q in s['questions']] + [q for c in cards for q in c['p3'] + c.get('followUps', [])] + [q for s in b3 for q in s['questions']])
print('PASS' if not fails else f'{len(fails)} FAILED')
sys.exit(1 if fails else 0)
