const { existsSync } = require('node:fs');
const { copyFile, cp } = require('node:fs/promises');
const { dirname, join, resolve } = require('node:path');

const runtime = join(__dirname, 'runtime');
const squirrelVendor = join(__dirname, '..', 'out', '.squirrel-vendor');
const certificate = process.env.FERRUM_WINDOWS_CERTIFICATE_FILE;
const signing = certificate
  ? {certificateFile: resolve(certificate), certificatePassword: process.env.FERRUM_WINDOWS_CERTIFICATE_PASSWORD}
  : undefined;

module.exports = {
  hooks: {
    async preMake() {
      const vendor = join(dirname(require.resolve('electron-winstaller/package.json')), 'vendor');
      const archiver = join(dirname(require.resolve('7zip-bin/package.json')), 'win', 'x64', '7za.exe');
      // Squirrel's vendored 7-Zip 16.04 fails to start on some Windows hosts.
      await cp(vendor, squirrelVendor, {recursive: true});
      await copyFile(archiver, join(squirrelVendor, '7z.exe'));
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
      /^\/(?:browser|docs|native|out|public|src|state|test|work)(?:\/|$)/,
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
        setupExe: 'CodingDungeonsSetup.exe',
        noMsi: true,
        ...signing,
      },
    },
  ],
};
