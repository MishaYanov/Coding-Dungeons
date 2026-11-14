import {createMobileEngine} from '../../lib/mobile/engine.mjs';
import goEnabled from 'virtual:mobile-go-enabled';
import rustEnabled from 'virtual:mobile-rust-enabled';
import rustInfo from 'virtual:mobile-rust-info';

const engines = new Map();

export function getMobileEngine(worldId = 'javascript') {
  if (!engines.has(worldId)) engines.set(worldId, Promise.resolve().then(() => createMobileEngine({
    worldId, goRunnerAvailable:goEnabled, rustRunnerAvailable:rustEnabled, rustRunnerVersion:rustInfo?.version,
    ...(goEnabled && worldId === 'go' ? {grade:gradeGo} : {}),
    ...(rustEnabled && worldId === 'rust' ? {grade:gradeRust} : {}),
  })));
  return engines.get(worldId);
}

async function gradeGo(request) {
  const {runGoWorkbench} = await import('../../lib/mobile/go-runner.mjs');
  return runGoWorkbench(request);
}

async function gradeRust(request) {
  const {runRustWorkbench} = await import('../../lib/mobile/rust-runner.mjs');
  return runRustWorkbench(request);
}
