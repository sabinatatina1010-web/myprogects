import { createSession } from './core.js';
import { catalogFeature } from './features/catalog.js';
import { fallbackFeature } from './features/fallback.js';
import { filesFeature } from './features/files.js';
import { handoffFeature } from './features/handoff.js';

const features = [
  filesFeature,
  catalogFeature,
  handoffFeature,
  fallbackFeature
];

export function createChat(options = {}) {
  return createSession(Object.assign({}, options, {
    features: options.features || features
  }));
}
