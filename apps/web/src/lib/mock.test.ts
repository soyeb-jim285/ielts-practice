import { describe, expect, it } from 'vitest';
import { stateLabel, transitionCopy, type Mock } from './mock';

const m = (next: Mock['next']) => ({ next, sections: [] });

describe('transitionCopy', () => {
  it('starts with Listening', () => expect(transitionCopy(m('listening'))!.title).toBe('Ready for Listening?'));
  it('names the finished section and the next one with its time', () => {
    const c = transitionCopy(m('reading'))!;
    expect(c.title).toBe('Listening finished.');
    expect(c.body).toContain('Next: Reading, 60 minutes');
  });
  it('writing is announced with both tasks on one clock', () => expect(transitionCopy(m('writing'))!.body).toContain('60 minutes for both tasks'));
  it('speaking offers a choice instead of a clock', () => expect(transitionCopy(m('speaking'))!.title).toMatch(/Choose how/));
  it('a finished mock has no transition', () => expect(transitionCopy(m(null))).toBeNull());
});

describe('stateLabel', () => {
  it('speaking says not taken yet, others not started', () => {
    expect(stateLabel({ skill: 'speaking', state: 'todo' }).text).toBe('Not taken yet');
    expect(stateLabel({ skill: 'reading', state: 'todo' }).text).toBe('Not started');
  });
  it('marking and failed are distinct', () => {
    expect(stateLabel({ skill: 'writing', state: 'marking' }).text).toBe('Being marked');
    expect(stateLabel({ skill: 'writing', state: 'failed' }).text).toBe('Marking failed, retry');
  });
});
