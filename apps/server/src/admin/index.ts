import type { App } from '../types';
import * as feedback from './feedback';
import * as logs from './logs';
import * as ops from './ops';
import * as replay from './replay';
import * as spend from './spend';
import * as stats from './stats';
import * as stt from './stt';

export function register(app: App) {
  for (const m of [stats, ops, replay, feedback, spend, stt, logs]) m.register(app);
}
