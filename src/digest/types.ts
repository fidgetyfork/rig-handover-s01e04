// Plan morning-digest § 1. Shared contract for the run log reader (issue #2) and every part of
// § 2 (page, JSON, board link, route tests). Types only: the reader lives elsewhere.

// Status of one line in runs/<night>.jsonl.
export type RunStatus = 'ok' | 'retry' | 'fail';

// One row per job for a night.
export type DigestRow = {
  // Job name as logged, e.g. "lane/sync".
  job: string;
  // Owner from the log. null is kept (the row is never dropped); views show '—'.
  owner: string | null;
  // Number of parsed lines for this job.
  runs: number;
  // Number of parsed lines for this job with status 'retry'.
  retries: number;
  // Status of the job's latest line (by `at`).
  lastStatus: RunStatus;
  // Most recent `error` logged for this job, from any line; null if none had one.
  lastError: string | null;
  // `at` of the job's earliest line, verbatim from the log (offset kept, never converted to UTC).
  firstAt: string;
  // `at` of the job's latest line, verbatim from the log (offset kept, never converted to UTC).
  lastAt: string;
};

// Line counts by status, over all parsed lines of the night (bad lines excluded).
export type StatusCounts = Record<RunStatus, number>;

// Everything the digest needs for one night.
export type Night = {
  // The night requested, "YYYY-MM-DD".
  night: string;
  // One row per job, sorted by job (ascending). Empty file → [] (renders "nothing ran").
  rows: DigestRow[];
  // Lines that didn't parse or didn't match the line shape: counted, never thrown.
  badLines: number;
  // Counts of parsed lines by status (for the board link).
  counts: StatusCounts;
};

// Reads runs/<night>.jsonl under runsDir. Returns null when the file does not exist (→ 404).
export type ReadNight = (runsDir: string, night: string) => Night | null;
