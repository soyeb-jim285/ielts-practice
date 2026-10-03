import type { App } from '../types';
import * as me from './me';
import * as settings from './settings';
import * as models from './models';
import * as prompts from './prompts';
import * as attempts from './attempts';
import * as live from './live';
import * as progress from './progress';
import * as mistakes from './mistakes';
import * as cards from './cards';
import * as community from './community';
import * as lr from './lr';

export function registerRoutes(app: App) {
  for (const m of [me, settings, models, prompts, attempts, live, progress, mistakes, cards, community, lr]) m.register(app);
}
