import {execFile} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const project = fileURLToPath(new URL('../../', import.meta.url));
const targetKiB = 2 * 1024 * 1024;

export function parseChromeMemory(output) {
  const rows = new Map();
  let current;
  for (const line of output.split(/\r?\n/)) {
    const header = /^\s*\*\* MEMINFO in pid (\d+) \[([^\]]+)\] \*\*\s*$/.exec(line);
    if (header) {
      if (current && !rows.has(current.pid)) throw new Error('Incomplete Android memory sample.');
      const pid = Number(header[1]);
      const name = header[2];
      if (!Number.isSafeInteger(pid) || pid <= 0 || rows.has(pid)
        || name !== 'com.android.chrome' && !name.startsWith('com.android.chrome:')) {
        throw new Error('Unexpected process in Android memory sample.');
      }
      current = {pid, name};
    }
    const total = /\bTOTAL PSS:\s*(\d+)\s+TOTAL RSS:\s*(\d+)\s+TOTAL SWAP PSS:\s*(\d+)\s*$/.exec(line);
    if (total) {
      if (!current || rows.has(current.pid)) throw new Error('Duplicate process in Android memory sample.');
      const [pssKiB, rssKiB, swapPssKiB] = total.slice(1).map(Number);
      if (![pssKiB, rssKiB, swapPssKiB].every(Number.isSafeInteger)) throw new Error('Invalid Android memory sample.');
      rows.set(current.pid, {...current, pssKiB, rssKiB, swapPssKiB});
    }
  }
  if (!rows.size || current && !rows.has(current.pid)) throw new Error('No complete Chrome memory sample. Open Chrome in the emulator first.');
  const processes = [...rows.values()];
  const sum = key => processes.reduce((total, process) => total + process[key], 0);
  return {pssKiB:sum('pssKiB'), rssKiB:sum('rssKiB'), swapPssKiB:sum('swapPssKiB'), processCount:processes.length, processes};
}

export function parseDeviceMemory(output) {
  const match = /^MemTotal:\s+(\d+)\s+kB\s*$/m.exec(output);
  const value = match && Number(match[1]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Android MemTotal was not available.');
  return value;
}

export function summarizeMemory(samples, deviceMemTotalKiB) {
  if (!samples.length) throw new Error('No successful Android memory samples.');
  const peak = samples.reduce((largest, sample) => sample.pssKiB > largest.pssKiB ? sample : largest);
  return {
    baseline:samples[0], peakPssKiB:peak.pssKiB, peakPssAtMs:peak.elapsedMs, peakProcessCount:peak.processCount,
    peakSwapPssKiB:Math.max(...samples.map(sample => sample.swapPssKiB)),
    peakPssPlusSwapKiB:Math.max(...samples.map(sample => sample.pssKiB + sample.swapPssKiB)),
    sampleCount:samples.length, deviceMemTotalKiB, targetKiB, pssWithin2GiB:peak.pssKiB <= targetKiB,
    limitations:'Includes all Chrome processes and tabs reported by dumpsys, including browser overhead. One-second sampling can miss short peaks; swap is reported separately. This emulator measurement does not establish support on physical 2 GB phones.',
  };
}

export async function measureAndroidMobile() {
  const serial = process.env.FERRUM_ANDROID_EMULATOR;
  if (!/^emulator-\d+$/.test(serial ?? '')) throw new Error('Set FERRUM_ANDROID_EMULATOR to the running emulator serial.');
  const adb = process.env.FERRUM_ADB || 'adb';
  const runAdb = args => execute(adb, ['-s', serial, ...args], {windowsHide:true, timeout:10_000, maxBuffer:4 * 1024 * 1024});
  const deviceMemTotalKiB = parseDeviceMemory((await runAdb(['shell', 'cat', '/proc/meminfo'])).stdout);
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const samples = [];
  const sampleErrors = [];
  async function sample() {
    const output = await runAdb(['shell', 'dumpsys', 'meminfo', '--package', 'com.android.chrome']);
    const result = {...parseChromeMemory(output.stdout), elapsedMs:Math.round(performance.now() - started)};
    samples.push(result);
    return result;
  }
  const baseline = await sample();
  console.log(`Chrome baseline: ${(baseline.pssKiB / 1024).toFixed(1)} MiB PSS, ${(baseline.swapPssKiB / 1024).toFixed(1)} MiB swap PSS across ${baseline.processCount} processes.`);
  let pending;
  const recordError = error => sampleErrors.push({elapsedMs:Math.round(performance.now() - started), error:error.message.slice(0, 300)});
  const timer = setInterval(() => {
    if (pending) return;
    pending = sample().catch(recordError).finally(() => { pending = undefined; });
  }, 1000);
  let testExitCode = 0;
  let testTimedOut = false;
  try {
    const result = await execute(process.execPath, ['--test', '--test-isolation=none', 'browser/mobile.test.mjs'], {
      cwd:project, windowsHide:true, timeout:300_000, maxBuffer:8 * 1024 * 1024,
      env:{...process.env, FERRUM_ANDROID_EMULATOR:serial, FERRUM_ADB:adb},
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  } catch (error) {
    testExitCode = Number.isInteger(error.code) ? error.code : 1;
    testTimedOut = Boolean(error.killed);
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    if (!error.stdout && !error.stderr) console.error(error.message);
  } finally {
    clearInterval(timer);
    await pending;
    await sample().catch(recordError);
  }
  const report = {startedAt, serial, ...summarizeMemory(samples, deviceMemTotalKiB),
    testExitCode, testTimedOut, sampleErrors, elapsedMs:Math.round(performance.now() - started), samples};
  const output = join(project, 'out', 'android-mobile-memory.json');
  await mkdir(join(project, 'out'), {recursive:true});
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Chrome peak: ${(report.peakPssKiB / 1024).toFixed(1)} MiB PSS; peak PSS plus swap: ${(report.peakPssPlusSwapKiB / 1024).toFixed(1)} MiB; ${report.sampleCount} successful samples, ${sampleErrors.length} failed samples.`);
  console.log(`Emulator MemTotal: ${(deviceMemTotalKiB / 1024 / 1024).toFixed(2)} GiB. ${report.limitations}`);
  console.log(`Measurement saved to ${output}.`);
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const report = await measureAndroidMobile();
  if (report.testExitCode || report.sampleErrors.length || !report.pssWithin2GiB) process.exitCode = 1;
}
