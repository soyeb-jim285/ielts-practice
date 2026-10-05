import type { App } from '../types';
import * as feedback from './feedback';
import * as ops from './ops';
import * as replay from './replay';
import * as spend from './spend';
import * as stats from './stats';

export function register(app: App) {
  for (const m of [stats, ops, replay, feedback, spend]) m.register(app);
}
