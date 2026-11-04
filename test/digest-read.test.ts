import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28', () => {
  const night = readNight('runs', '2026-10-28');

  it('reads one row per job, sorted by job, and counts the bad line', () => {
    expect(night).not.toBeNull();
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night?.badLines).toBe(1);
  });

  it('keeps a null owner', () => {
    expect(night?.rows.find((r) => r.job === 'digest/render')?.owner).toBeNull();
  });

  it('counts retries and takes the latest status', () => {
    const row = night?.rows.find((r) => r.job === 'fixtures/refresh');
    expect(row?.retries).toBe(3);
    expect(row?.runs).toBe(4);
    expect(row?.lastStatus).toBe('ok');
    expect(row?.lastError).toBe('upstream 503');
    expect(row?.firstAt).toBe('2026-10-29T01:30:00+01:00');
    expect(row?.lastAt).toBe('2026-10-29T01:37:00+01:00');
  });

  it('keeps the last error of a failed job', () => {
    const row = night?.rows.find((r) => r.job === 'notes/backup');
    expect(row?.lastStatus).toBe('fail');
    expect(row?.lastError).toBe('quota exceeded');
  });

  it('counts parsed lines by status', () => {
    // By hand: ok 10 (rotate-logs 1, lane/sync 7, fixtures 1, digest 1), retry 4, fail 1.
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });
});

describe('readNight edge cases', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for a missing file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('reads an empty file as no rows', () => {
    writeFileSync(join(dir, '2026-01-01.jsonl'), '');
    expect(readNight(dir, '2026-01-01')).toEqual({
      night: '2026-01-01',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('returns null for an invalid night', () => {
    writeFileSync(join(dir, 'x.jsonl'), '');
    expect(readNight(dir, '../x')).toBeNull();
    expect(readNight(dir, 'x')).toBeNull();
  });

  it('orders by time and takes the owner of the latest line', () => {
    writeFileSync(
      join(dir, '2026-01-01.jsonl'),
      [
        '{"at":"2026-01-01T02:00:00+01:00","job":"a","status":"ok","owner":"late"}',
        '{"at":"2026-01-01T01:00:00+01:00","job":"a","status":"retry","owner":"early","error":"e"}',
        '{"at":"2026-01-01T01:30:00+01:00","job":"a","status":"bogus","owner":"x"}',
        '',
      ].join('\n'),
    );
    const night = readNight(dir, '2026-01-01');
    expect(night?.badLines).toBe(1);
    expect(night?.rows[0]).toEqual({
      job: 'a',
      owner: 'late',
      runs: 2,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'e',
      firstAt: '2026-01-01T01:00:00+01:00',
      lastAt: '2026-01-01T02:00:00+01:00',
    });
  });
});
