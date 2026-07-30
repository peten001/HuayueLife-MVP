import type { PrintingJob } from '@/types/printing';

export type PrintingTestPollOutcome =
  | 'SUCCEEDED'
  | 'FAILED'
  | 'UNCERTAIN'
  | 'TIMEOUT'
  | 'ABORTED';

export interface PrintingTestPollResult {
  outcome: PrintingTestPollOutcome;
  job: PrintingJob | null;
}

interface PrintingTestPollingOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export function printingTestTerminalOutcome(
  job: PrintingJob,
): Exclude<PrintingTestPollOutcome, 'TIMEOUT' | 'ABORTED'> | null {
  if (job.status === 'SUCCEEDED') return 'SUCCEEDED';
  if (job.status !== 'FAILED' && job.status !== 'CANCELLED') return null;
  const attempt = job.latestAttempt ?? job.attempts?.[job.attempts.length - 1];
  if (
    job.retryBlocked
    || job.lastErrorCode === 'PRINT_OUTCOME_UNKNOWN'
    || attempt?.errorCode === 'PRINT_OUTCOME_UNKNOWN'
    || attempt?.result === 'OUTCOME_UNKNOWN'
  ) {
    return 'UNCERTAIN';
  }
  return 'FAILED';
}

export async function pollPrintingTestJob(
  jobId: string,
  fetchJob: (id: string) => Promise<PrintingJob>,
  options: PrintingTestPollingOptions = {},
): Promise<PrintingTestPollResult> {
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? 1_500;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  }));
  const startedAt = now();
  let latest: PrintingJob | null = null;

  while (now() - startedAt <= timeoutMs) {
    if (options.signal?.aborted) return { outcome: 'ABORTED', job: latest };
    latest = await fetchJob(jobId);
    if (options.signal?.aborted) return { outcome: 'ABORTED', job: latest };
    const outcome = printingTestTerminalOutcome(latest);
    if (outcome) return { outcome, job: latest };
    await sleep(intervalMs);
  }

  if (options.signal?.aborted) return { outcome: 'ABORTED', job: latest };
  return { outcome: 'TIMEOUT', job: latest };
}
