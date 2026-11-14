import {createMobileEngine} from '../../lib/mobile/engine.mjs';
import goEnabled from 'virtual:mobile-go-enabled';

const engines = new Map();

export function getMobileEngine(worldId = 'javascript') {
  if (!engines.has(worldId)) engines.set(worldId, Promise.resolve().then(() => createMobileEngine({
    worldId, goRunnerAvailable:goEnabled, ...(goEnabled && worldId === 'go' ? {grade:gradeGo} : {}),
  })));
  return engines.get(worldId);
}

async function gradeGo(request) {
  const {runGoWorkbench} = await import('../../lib/mobile/go-runner.mjs');
  return runGoWorkbench(request);
}
