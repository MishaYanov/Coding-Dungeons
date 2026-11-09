const { createHash } = require('node:crypto');
const { createReadStream, existsSync } = require('node:fs');
const { copyFile, cp, readFile, readdir, realpath, stat, writeFile } = require('node:fs/promises');
const { basename, dirname, isAbsolute, join, relative, resolve, sep } = require('node:path');

const runtime = join(__dirname, 'runtime');
const squirrelVendor = join(__dirname, '..', 'out', '.squirrel-vendor');
const setupExe = 'CodingDungeonsSetup.exe';
// Match the pinned model checked by stage-gm-runtime.ps1.
const offlineModelSha256 = '9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031';
const offlineModelAssets = ['gm-model.gguf', 'llama-completion.exe', 'llama-completion-impl.dll', 'llama-common.dll',
  'llama.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu-x64.dll', 'libomp.dll', 'mtmd.dll',
  'LICENSE-LLVM-OpenMP', 'LICENSE-llama.cpp.txt', 'LICENSE-Qwen3.txt'];
const packagedPaths = [
  /^\/(?:LICENSE|package\.json|server\.mjs)$/,
  /^\/node_modules(?:\/|$)/,
  /^\/desktop(?:\/(?:book-links|engine-lifecycle|main|reader-storage|runtime-config|save-transfer|window-policy)\.mjs|\/preload\.cjs)?$/,
  /^\/infra(?:\/run-suite\.sh)?$/,
  /^\/lib(?:\/[\w-]+\.mjs)?$/,
  /^\/data(?:\/(?:campaign|exercises|gm-rubrics|pages)\.json|\/workbench(?:\/[\w-]+\.mjs)?|\/worlds(?:\/(?:go|javascript|typescript)(?:\/(?:campaign|exercises|pages)\.json)?)?)?$/,
  /^\/dist(?:\/renderer(?:\/(?:index\.html|styles\.css|assets(?:\/[\w-]+\.(?:css|js))?|book(?:\/(?:go|javascript|typescript))?(?:\/pages(?:\/\d+\.webp)?|\/[\w-]+\.(?:pdf|zip))?))?)?$/,
];

function ignorePackagePath(path) {
  if (!path) return false;
  const privateFile = /(?:^|\/)(?:\.git|\.bin|\.npmrc|\.env(?:\.[^/]+)?)(?:\/|$)|\.(?:pfx|p12|pem|key|db|sqlite3?)(?:-wal|-shm)?$/i;
  return privateFile.test(path) || !packagedPaths.some(pattern => pattern.test(path));
}

const certificate = process.env.FERRUM_WINDOWS_CERTIFICATE_FILE;
const signing = certificate
  ? {certificateFile: resolve(certificate), certificatePassword: process.env.FERRUM_WINDOWS_CERTIFICATE_PASSWORD}
  : undefined;

async function checkRuntimeResources() {
  if (!existsSync(runtime)) return;
  const root = await realpath(runtime);
  if (signing) {
    const location = relative(root, await realpath(signing.certificateFile));
    if (!isAbsolute(location) && location !== '..' && !location.startsWith(`..${sep}`)) {
      throw new Error('Keep the Windows signing certificate outside the bundled runtime folder.');
    }
  }
  const modelAssets = /^(?:gm-model\.gguf|llama-completion\.exe|llama(?:-common|-completion-impl)?\.dll|ggml(?:-base|-cpu-[\w-]+)?\.dll|libomp\.dll|mtmd\.dll|LICENSE-(?:LLVM-OpenMP|llama\.cpp\.txt|Qwen3\.txt))$/;
  for (const entry of await readdir(root, {withFileTypes: true})) {
    if (entry.name === 'standalone-runner' ? entry.isDirectory() : entry.isFile() && modelAssets.test(entry.name)) continue;
    throw new Error(`Unexpected bundled runtime entry: ${entry.name}`);
  }
  for (const entry of await readdir(root, {withFileTypes: true, recursive: true})) {
    const file = join(entry.parentPath, entry.name);
    const path = relative(root, file).split(sep).join('/');
    if (entry.isSymbolicLink() || /^(?:\.git$|\.env(?:\.|$))|\.(?:pfx|p12|db|sqlite3?)(?:-wal|-shm)?$|\.(?:pem|key)$/i.test(entry.name)) {
      throw new Error(`Remove the private or linked entry from the bundled runtime: ${path}`);
    }
  }
}

async function requireOfflineRuntime() {
  await checkRuntimeResources();
  for (const name of offlineModelAssets) {
    const asset = await stat(join(runtime, name)).catch(() => null);
    if (!asset?.isFile() || asset.size === 0) {
      throw new Error(`The offline runtime is missing ${name}. Run desktop/stage-gm-runtime.ps1 before making the installer.`);
    }
  }
  const {inspectNativeRunnerAssets} = await import('../lib/standalone-runner.mjs');
  const native = await inspectNativeRunnerAssets(join(runtime, 'standalone-runner'));
  if (!native?.languages?.includes('rust') || !native.languages.includes('go')) {
    throw new Error('The offline runtime needs complete Rust and Go assets. Run desktop/stage-native-runtime.ps1 before making the installer.');
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(runtime, 'gm-model.gguf'))) hash.update(chunk);
  if (hash.digest('hex') !== offlineModelSha256) {
    throw new Error('The bundled GM model did not match its pinned checksum. Run desktop/stage-gm-runtime.ps1 again.');
  }
}

async function allowLargeAddresses(filename) {
  const binary = await readFile(filename);
  const header = binary.readUInt32LE(0x3c);
  if (binary.toString('ascii', header, header + 4) !== 'PE\0\0' || binary.readUInt16LE(header + 4) !== 0x14c) {
    throw new Error(`Unexpected Windows x86 helper format at ${filename}`);
  }
  const characteristics = header + 22;
  binary.writeUInt16LE(binary.readUInt16LE(characteristics) | 0x20, characteristics);
  await writeFile(filename, binary);
}

module.exports = {
  hooks: {
    prePackage: checkRuntimeResources,
    async preMake() {
      await requireOfflineRuntime();
      const vendor = join(dirname(require.resolve('electron-winstaller/package.json')), 'vendor');
      const archiver = join(dirname(require.resolve('7zip-bin/package.json')), 'win', 'x64', '7za.exe');
      // Squirrel's vendored 7-Zip 16.04 fails to start on some Windows hosts.
      await cp(vendor, squirrelVendor, {recursive: true});
      await copyFile(archiver, join(squirrelVendor, '7z.exe'));
      // Both x86 helpers can hold two copies of the embedded payload in memory.
      await Promise.all(['WriteZipToSetup.exe', 'rcedit.exe'].map((name) => allowLargeAddresses(join(squirrelVendor, name))));
    },
    async postMake(_config, results) {
      for (const {artifacts} of results) {
        const setup = artifacts.find((file) => basename(file) === setupExe);
        if (!setup) continue;
        const payload = artifacts.find((file) => file.endsWith('-full.nupkg'));
        // Squirrel can report success even after dropping the embedded archive.
        if (!payload || (await stat(setup)).size < (await stat(payload)).size / 2) {
          throw new Error('The Squirrel setup is missing its offline payload.');
        }
      }
      return results;
    },
  },
  packagerConfig: {
    asar: true,
    executableName: 'Coding Dungeons',
    download: {cacheRoot: join(__dirname, '..', 'out', '.electron-cache')},
    extraResource: existsSync(runtime) ? [runtime] : [],
    ...(signing && {windowsSign: signing}),
    ignore: ignorePackagePath,
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'CodingDungeons',
        vendorDirectory: squirrelVendor,
        exe: 'Coding Dungeons.exe',
        setupExe,
        noMsi: true,
        ...signing,
      },
    },
  ],
};
