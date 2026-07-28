import type {
  PrintingAttemptSummary,
  PrintingJob,
} from '@/types/printing';

export type PrintingJobDisplayState =
  | 'WAITING_EXECUTION'
  | 'CLAIMED'
  | 'PRINTING'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'PRINTED'
  | 'RETRY_WAIT'
  | 'FAILED'
  | 'UNKNOWN'
  | 'NOT_CONFIGURED'
  | 'CANCELLED';

export function latestPrintingAttempt(
  job: PrintingJob,
): PrintingAttemptSummary | null {
  if (job.latestAttempt) return job.latestAttempt;
  return job.attempts?.length ? job.attempts[job.attempts.length - 1] : null;
}

export function printingJobDisplayState(
  job: PrintingJob,
): PrintingJobDisplayState {
  const cloudStatus = latestPrintingAttempt(job)?.cloudStatus;
  if (cloudStatus) {
    if (cloudStatus === 'PENDING') return 'WAITING_EXECUTION';
    return cloudStatus;
  }
  if (job.status === 'PENDING') return 'WAITING_EXECUTION';
  if (job.status === 'SUCCEEDED') return 'PRINTED';
  return job.status;
}

export function printingJobCanRetry(job: PrintingJob) {
  return (
    job.status === 'FAILED' &&
    !job.retryBlocked &&
    latestPrintingAttempt(job)?.cloudStatus !== 'UNKNOWN' &&
    job.lastErrorCode !== 'PRINT_OUTCOME_UNKNOWN' &&
    job.attemptCount < job.maxAttempts
  );
}

export function printingJobCanReprint(job: PrintingJob) {
  const state = printingJobDisplayState(job);
  return state === 'PRINTED' || state === 'UNKNOWN';
}
