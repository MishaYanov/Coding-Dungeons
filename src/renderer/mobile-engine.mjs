import {createMobileEngine} from '../../lib/mobile/engine.mjs';

let engine;

export function getMobileEngine() {
  engine ??= Promise.resolve().then(() => createMobileEngine());
  return engine;
}
