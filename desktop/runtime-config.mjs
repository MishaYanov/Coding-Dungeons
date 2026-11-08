import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const nativeWorkerFiles = ['broker.exe', 'sandbox-probe.exe', 'wasm-worker/wasm-worker.exe'];
const nativeCompilerFiles = {
  rust: ['rust/bin/rustc.exe', 'rust/wasm-linker.exe'],
  go: ['go/bin/go.exe'],
};

function resolvePackagedFile(directory, name) {
  try {
    if (!lstatSync(directory).isDirectory()) return undefined;
    const root = realpathSync(directory);
    const file = join(root, name);
    if (!lstatSync(file).isFile()) return undefined;
    const resolved = realpathSync(file);
    return relative(root, resolved) === normalize(name) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function nativeRuntime(directory) {
  const manifest = resolvePackagedFile(directory, 'native-runner.json');
  if (!manifest) return undefined;
  try {
    if (lstatSync(manifest).size > 16 * 1024) return undefined;
    const {version, languages, executables} = JSON.parse(readFileSync(manifest, 'utf8'));
    if (version !== 1 || !Array.isArray(languages) || languages.length === 0
      || new Set(languages).size !== languages.length
      || !languages.every((name) => typeof name === 'string' && Object.hasOwn(nativeCompilerFiles, name))) return undefined;
    const required = [...nativeWorkerFiles, ...languages.flatMap((name) => nativeCompilerFiles[name])];
    if (!executables || Object.keys(executables).length !== required.length) return undefined;
    if (!required.every((name) =>
      typeof executables[name] === 'string' && /^[a-f0-9]{64}$/i.test(executables[name])
      && resolvePackagedFile(directory, name))) return undefined;
    return {directory: dirname(manifest), languages};
  } catch {
    return undefined;
  }
}

function hasPackage(name) {
  try {
    return existsSync(fileURLToPath(import.meta.resolve(name)));
  } catch {
    return false;
  }
}

export function discoverRuntime(directory, packageAvailable = hasPackage) {
  const cli = resolvePackagedFile(directory, 'llama-completion.exe');
  const weights = resolvePackagedFile(directory, 'gm-model.gguf');
  const model = cli && weights ? {cli, weights} : undefined;
  const native = nativeRuntime(join(directory, 'standalone-runner'));
  const javascript = packageAvailable('quickjs-emscripten');
  return {
    model,
    nativeRunner: native?.directory,
    nativeLanguages: native?.languages ?? [],
    available: {
      javascript,
      typescript: javascript && packageAvailable('typescript'),
      model: Boolean(model),
      native: Boolean(native),
    },
  };
}
