import assert from 'node:assert/strict';
import test from 'node:test';
import {parseChromeMemory, parseDeviceMemory, summarizeMemory} from '../work/scripts/measure-android-mobile.mjs';

// Shape and first process values captured from the current Android emulator.
const process = `** MEMINFO in pid 3499 [com.android.chrome:privileged_process0] **
                  Pss  Private  Private
                Total    Dirty    Clean
  TOTAL         59761    10000    20000
 App Summary
           TOTAL PSS:    59761            TOTAL RSS:   182028       TOTAL SWAP PSS:    31856
`;
const second = `** MEMINFO in pid 4010 [com.android.chrome] **
 App Summary
           TOTAL PSS:    10000            TOTAL RSS:   30000       TOTAL SWAP PSS:    4000
`;

test('Android memory parsing sums each Chrome process summary once and keeps swap separate', () => {
  assert.deepEqual(parseChromeMemory(process + second), {
    pssKiB:69761, rssKiB:212028, swapPssKiB:35856, processCount:2,
    processes:[{pid:3499, name:'com.android.chrome:privileged_process0', pssKiB:59761, rssKiB:182028, swapPssKiB:31856},
      {pid:4010, name:'com.android.chrome', pssKiB:10000, rssKiB:30000, swapPssKiB:4000}],
  });
});

test('incomplete, duplicate and foreign-process memory samples cannot undercount Chrome', () => {
  for (const sample of ['', process + process, process + second.split(' App Summary')[0],
    process.replace('com.android.chrome:privileged_process0', 'unrelated.app')]) {
    assert.throws(() => parseChromeMemory(sample), /memory sample/i);
  }
});

test('device RAM parsing uses the observed MemTotal field in KiB', () => {
  assert.equal(parseDeviceMemory('MemTotal:        4005300 kB\nMemFree: 900000 kB'), 4005300);
  assert.throws(() => parseDeviceMemory('MemFree: 900000 kB'), /MemTotal/);
});

test('memory report includes baseline, peak PSS and peak combined PSS and swap without claiming device support', () => {
  const baseline = {...parseChromeMemory(process), elapsedMs:0};
  const highPss = {...baseline, elapsedMs:1000, pssKiB:150000, swapPssKiB:1000};
  const highSwap = {...baseline, elapsedMs:2000, pssKiB:120000, swapPssKiB:50000};
  const summary = summarizeMemory([baseline, highPss, highSwap], 4005300);
  assert.equal(summary.baseline.pssKiB, 59761);
  assert.equal(summary.peakPssKiB, 150000);
  assert.equal(summary.peakSwapPssKiB, 50000);
  assert.equal(summary.peakPssPlusSwapKiB, 170000);
  assert.equal(summary.pssWithin2GiB, true);
  assert.equal(summary.deviceMemTotalKiB, 4005300);
  assert.match(summary.limitations, /does not establish.*2 GB/i);
});
