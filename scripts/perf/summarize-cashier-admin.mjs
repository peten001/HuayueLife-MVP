import { readFile } from 'node:fs/promises';

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error('Usage: node scripts/perf/summarize-cashier-admin.mjs <measurements.json>');
}

const measurements = JSON.parse(await readFile(inputPath, 'utf8'));
for (const group of ['cashierBefore', 'cashierAfter', 'adminBefore', 'adminAfter']) {
  if (!Array.isArray(measurements[group]) || measurements[group].length < 5) {
    throw new Error(`${group} must contain at least five runs`);
  }
}

function percentile(values, ratio) {
  const sorted = values.toSorted((left, right) => left - right);
  const rank = Math.ceil(sorted.length * ratio) - 1;
  return sorted[Math.max(0, rank)];
}

function summarize(runs, durationKey) {
  const durations = runs.map((run) => Number(run[durationKey]));
  return {
    runs: runs.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
  };
}

const report = {
  cashierBefore: summarize(measurements.cashierBefore, 'uiReadyMs'),
  cashierAfter: summarize(measurements.cashierAfter, 'uiReadyMs'),
  adminBefore: summarize(measurements.adminBefore, 'uiReadyMs'),
  adminAfter: summarize(measurements.adminAfter, 'uiReadyMs'),
};

console.log(JSON.stringify(report, null, 2));
