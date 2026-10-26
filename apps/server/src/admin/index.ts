import type { App } from '../types';
import * as emails from './emails';
import * as feedback from './feedback';
import * as logs from './logs';
import * as ops from './ops';
import * as replay from './replay';
import * as spend from './spend';
import * as stats from './stats';
import * as pronunciation from './pronunciation';
import * as stt from './stt';
import * as latency from './latency';
import * as coach from './coach';

export function register(app: App) {
  for (const m of [stats, ops, replay, feedback, emails, spend, stt, pronunciation, logs, latency, coach]) m.register(app);
}
