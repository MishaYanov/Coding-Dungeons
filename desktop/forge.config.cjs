const { existsSync } = require('node:fs');
const { copyFile, cp, readFile, stat, writeFile } = require('node:fs/promises');
const { basename, dirname, join, resolve } = require('node:path');

const runtime = join(__dirname, 'runtime');
const squirrelVendor = join(__dirname, '..', 'out', '.squirrel-vendor');
const setupExe = 'CodingDungeonsSetup.exe';
const certificate = process.env.FERRUM_WINDOWS_CERTIFICATE_FILE;
const signing = certificate
  ? {certificateFile: resolve(certificate), certificatePassword: process.env.FERRUM_WINDOWS_CERTIFICATE_PASSWORD}
  : undefined;

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
    async preMake() {
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
    ignore: [
      /^\/\.(?:git|github|idea|npm-cache|vscode)(?:\/|$)/,
      /^\/\.(?:env|env\.[^/]+)$/,
      /^\/\.npmrc$/,
      /^\/debug\.log$/,
      /^\/(?:browser|docs|native|out|outputs|public|src|state|test|work)(?:\/|$)/,
      /^\/desktop\/runtime(?:\/|$)/,
    ],
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
