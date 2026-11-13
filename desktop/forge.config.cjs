const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createReadStream, existsSync } = require('node:fs');
const { copyFile, cp, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { basename, dirname, isAbsolute, join, relative, resolve, sep } = require('node:path');
const { promisify } = require('node:util');

const run = promisify(execFile);
const runtime = join(__dirname, 'runtime');
const squirrelVendor = join(__dirname, '..', 'out', '.squirrel-vendor');
const executableName = 'Coding Dungeons';
// The official Windows release is available ahead of the npm wrapper.
const desktopElectronVersion = '45.3.2';
const desktopElectronZipSha256 = 'cd1ab0d49c2f76838c0c9ff75afefb4d9d85ca59036691932bf35be8eceba98b';
const runnerGoVersion = 'go1.27.4';
const workerDotnetVersion = '10.0.15';
const localInstaller = process.env.FERRUM_ALLOW_UNSIGNED_INSTALLER === '1';
const desktopTestPackage = process.env.FERRUM_DESKTOP_TEST_PACKAGE === '1';
const setupExe = localInstaller ? 'CodingDungeonsSetup-local.exe' : 'CodingDungeonsSetup.exe';
// Match the pinned model checked by stage-gm-runtime.ps1.
const offlineModelSha256 = '9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031';
const offlineModelAssets = ['gm-model.gguf', 'llama-completion.exe', 'llama-completion-impl.dll', 'llama-common.dll',
  'llama.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu-x64.dll', 'libomp.dll', 'mtmd.dll',
  'LICENSE-LLVM-OpenMP', 'LICENSE-llama.cpp.txt', 'LICENSE-Qwen3.txt'];
const packagedPaths = [
  /^\/(?:LICENSE|package\.json|server\.mjs)$/,
  /^\/node_modules(?:\/|$)/,
  /^\/desktop(?:\/(?:book-links|engine-lifecycle|main|reader-storage|runtime-config|save-transfer|window-policy)\.mjs|\/preload\.cjs)?$/,
  /^\/lib(?:\/[\w-]+\.mjs)?$/,
  /^\/data(?:\/(?:campaign|exercises|gm-rubrics|pages)\.json|\/workbench(?:\/[\w-]+\.mjs)?|\/worlds(?:\/(?:go|javascript|typescript)(?:\/(?:campaign|exercises|pages)\.json)?)?)?$/,
  /^\/dist(?:\/renderer(?:\/(?:index\.html|styles\.css|assets(?:\/[\w-]+\.(?:css|js))?|book(?:\/(?:go|javascript|typescript))?(?:\/pages(?:\/\d+\.webp)?|\/[\w-]+\.(?:pdf|zip))?))?)?$/,
];

function ignorePackagePath(path) {
  if (!path) return false;
  const privateFile = /(?:^|\/)(?:\.git|\.bin|\.npmrc|\.env(?:\.[^/]+)?)(?:\/|$)|\.(?:pfx|p12|pem|key|db|sqlite3?)(?:-wal|-shm)?$/i;
  return privateFile.test(path) || !packagedPaths.some(pattern => pattern.test(path));
}

const certificate = localInstaller ? undefined : process.env.FERRUM_WINDOWS_CERTIFICATE_FILE;
const thumbprint = localInstaller ? undefined : process.env.FERRUM_WINDOWS_CERTIFICATE_THUMBPRINT?.trim();
const signTool = process.env.FERRUM_WINDOWS_SIGNTOOL || 'signtool.exe';
const timestampUrl = process.env.FERRUM_WINDOWS_TIMESTAMP_URL || 'http://timestamp.digicert.com';

async function requireSigning() {
  if (localInstaller) return;
  if (!certificate && !thumbprint) {
    throw new Error('A release installer requires a Windows signing certificate. Configure FERRUM_WINDOWS_CERTIFICATE_THUMBPRINT or FERRUM_WINDOWS_CERTIFICATE_FILE.');
  }
  if (thumbprint && !/^[a-f0-9]{40}$/i.test(thumbprint)) {
    throw new Error('FERRUM_WINDOWS_CERTIFICATE_THUMBPRINT must contain 40 hexadecimal characters.');
  }
  if (certificate && !(await stat(resolve(certificate)).catch(() => null))?.isFile()) {
    throw new Error('The Windows signing certificate file is missing.');
  }
}

async function signWindowsFile(file) {
  const args = ['sign', '/fd', 'SHA256', '/tr', timestampUrl, '/td', 'SHA256'];
  if (thumbprint) args.push('/sha1', thumbprint);
  if (certificate) {
    args.push('/f', resolve(certificate));
    const password = process.env.FERRUM_WINDOWS_CERTIFICATE_PASSWORD;
    if (password) args.push('/p', password);
  }
  try {
    await run(signTool, [...args, file], {windowsHide: true, timeout: 120_000});
  } catch (error) {
    // A failed child process includes its command line, which may contain the PFX password.
    const detail = error.code === 'ENOENT' ? ' Set FERRUM_WINDOWS_SIGNTOOL to your Windows SDK SignTool path.' : '';
    throw new Error('Authenticode signing failed for ' + basename(file) + '.' + detail);
  }
}

async function verifyWindowsFile(file) {
  const signatureCheck = [
    '$signature = Get-AuthenticodeSignature -LiteralPath $env:FERRUM_VERIFY_SIGNED_FILE',
    'if ($signature.Status -ne "Valid" -or !$signature.TimeStamperCertificate) { exit 1 }',
    'if ($env:FERRUM_VERIFY_SIGNER -and $signature.SignerCertificate.Thumbprint -ne $env:FERRUM_VERIFY_SIGNER) { exit 1 }',
  ].join('\n');
  const env = {...process.env, FERRUM_VERIFY_SIGNED_FILE: file, FERRUM_VERIFY_SIGNER: thumbprint ?? ''};
  delete env.FERRUM_WINDOWS_CERTIFICATE_PASSWORD;
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', signatureCheck], {
      windowsHide: true, timeout: 120_000,
      env,
    });
  } catch {
    throw new Error('Windows could not verify the publisher and timestamp for ' + basename(file) + '.');
  }
}

async function verifyPackagedApplication(payload) {
  const directory = await mkdtemp(join(tmpdir(), 'coding-dungeons-signature-'));
  const entry = 'lib/net45/' + executableName + '.exe';
  try {
    try {
      await run('tar.exe', ['-xf', payload, '-C', directory, entry], {windowsHide: true, timeout: 120_000});
    } catch {
      throw new Error('The installer payload did not contain a readable application executable.');
    }
    const executable = join(directory, entry);
    const {getCurrentFuseWire, FuseV1Options, FuseState} = await import('@electron/fuses');
    const fuses = await getCurrentFuseWire(executable);
    const disabled = [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable,
      FuseV1Options.EnableNodeCliInspectArguments];
    const enabled = [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseV1Options.OnlyLoadAppFromAsar];
    if (disabled.some(fuse => fuses[fuse] !== FuseState.DISABLE)
      || enabled.some(fuse => fuses[fuse] !== FuseState.ENABLE)) {
      throw new Error('Build the Windows package without FERRUM_DESKTOP_TEST_PACKAGE before making the installer.');
    }
    await verifyWindowsFile(executable);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

async function checkRuntimeResources() {
  if (!existsSync(runtime)) return;
  const root = await realpath(runtime);
  if (certificate) {
    const location = relative(root, await realpath(resolve(certificate)));
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
  const nativeDirectory = join(runtime, 'standalone-runner');
  const native = await inspectNativeRunnerAssets(nativeDirectory);
  if (!native?.languages?.includes('rust') || !native.languages.includes('go')) {
    throw new Error('The offline runtime needs complete Rust and Go assets. Run desktop/stage-native-runtime.ps1 before making the installer.');
  }
  await requireNativeVersions(nativeDirectory);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(runtime, 'gm-model.gguf'))) hash.update(chunk);
  if (hash.digest('hex') !== offlineModelSha256) {
    throw new Error('The bundled GM model did not match its pinned checksum. Run desktop/stage-gm-runtime.ps1 again.');
  }
}

async function requireNativeVersions(directory) {
  const [go, dotnet] = await Promise.all([
    readFile(join(directory, 'go', 'VERSION'), 'utf8').catch(() => ''),
    readFile(join(directory, 'wasm-worker', 'wasm-worker.runtimeconfig.json'), 'utf8').catch(() => ''),
  ]);
  let framework;
  try {
    framework = JSON.parse(dotnet).runtimeOptions?.includedFrameworks?.find(item => item.name === 'Microsoft.NETCore.App');
  } catch {
    // A missing or malformed runtime configuration cannot prove the required version.
  }
  if (go.trim().split(/\s+/)[0] !== runnerGoVersion || framework?.version !== workerDotnetVersion) {
    throw new Error(`Stage Go ${runnerGoVersion} and .NET ${workerDotnetVersion} with desktop/stage-native-runtime.ps1 before making the installer.`);
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
    readPackageJson(_config, manifest) {
      return {...manifest, devDependencies:{...manifest.devDependencies, electron:desktopElectronVersion}};
    },
    prePackage: checkRuntimeResources,
    async postPackage(_config, {platform, outputPaths}) {
      if (platform !== 'win32' || (!certificate && !thumbprint)) return;
      await requireSigning();
      for (const directory of outputPaths) {
        const executable = join(directory, executableName + '.exe');
        await signWindowsFile(executable);
        await verifyWindowsFile(executable);
      }
    },
    async preMake() {
      if (desktopTestPackage) throw new Error('Build installers from a fresh package without FERRUM_DESKTOP_TEST_PACKAGE.');
      await requireSigning();
      await requireOfflineRuntime();
      const vendor = join(dirname(require.resolve('electron-winstaller/package.json')), 'vendor');
      const archiver = join(dirname(require.resolve('7zip-bin/package.json')), 'win', 'x64', '7za.exe');
      // Squirrel's vendored 7-Zip 16.04 fails to start on some Windows hosts.
      await cp(vendor, squirrelVendor, {recursive: true});
      await copyFile(archiver, join(squirrelVendor, '7z.exe'));
      // Both x86 helpers can hold two copies of the embedded payload in memory.
      await Promise.all(['WriteZipToSetup.exe', 'rcedit.exe'].map((name) => allowLargeAddresses(join(squirrelVendor, name))));
      if (!localInstaller) {
        const updater = join(squirrelVendor, 'Squirrel.exe');
        await signWindowsFile(updater);
        await verifyWindowsFile(updater);
      }
    },
    async postMake(_config, results) {
      const installers = results.filter(result => result.maker === 'squirrel');
      if (!installers.length) throw new Error('The Windows installer build produced no Squirrel artifacts.');
      for (const {artifacts} of installers) {
        const setup = artifacts.find((file) => basename(file) === setupExe);
        const payload = artifacts.find((file) => file.endsWith('-full.nupkg'));
        // Squirrel can report success even after dropping the embedded archive.
        if (!setup || !payload || (await stat(setup)).size < (await stat(payload)).size / 2) {
          throw new Error('The Squirrel setup is missing its offline payload.');
        }
        if (!localInstaller) {
          await verifyPackagedApplication(payload);
          await signWindowsFile(setup);
          await verifyWindowsFile(setup);
        }
      }
      return results;
    },
  },
  packagerConfig: {
    asar: true,
    executableName,
    download: {
      cacheRoot: join(__dirname, '..', 'out', '.electron-cache'),
      checksums: {[`electron-v${desktopElectronVersion}-win32-x64.zip`]: desktopElectronZipSha256},
    },
    extraResource: existsSync(runtime) ? [runtime] : [],
    afterExtract: [async ({buildPath, platform}) => {
      if (platform !== 'win32') return;
      const {flipFuses, FuseVersion, FuseV1Options} = await import('@electron/fuses');
      await flipFuses(join(buildPath, 'electron.exe'), {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: false,
        // Playwright's desktop test attaches to the Electron main-process inspector.
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: desktopTestPackage,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
      });
    }],
    ignore: ignorePackagePath,
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'CodingDungeons',
        vendorDirectory: squirrelVendor,
        exe: executableName + '.exe',
        setupExe,
        noMsi: true,
      },
    },
  ],
};
