import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { nativeBrokerEnvironment } from '../lib/standalone-runner.mjs';

const exec = promisify(execFile);
const compiler = join(process.env.SystemRoot ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const source = name => fileURLToPath(new URL(`../native/${name}`, import.meta.url));

test('Windows broker proves the LPAC and Job Object boundary', {
  skip: process.platform !== 'win32' || process.arch !== 'x64' || process.env.DUNGEONS_TEST_NATIVE_BROKER !== '1',
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coding-dungeons-sandbox-'));
  try {
    const executable = join(directory, 'probe.exe');
    await exec(compiler, ['/nologo', '/target:exe', '/platform:x64', `/out:${executable}`,
      source('WindowsSandbox.cs'), source('SandboxProbe.cs')], { windowsHide: true, timeout: 10_000 });
    const result = await exec(executable, ['probe'], {
      cwd: directory, env: nativeBrokerEnvironment(), windowsHide: true, timeout: 15_000,
    });
    assert.equal(result.stdout.trim(), 'LPAC, file isolation, loopback denial, and job cleanup verified.');
    assert.equal(result.stderr, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
