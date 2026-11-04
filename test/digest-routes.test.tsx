import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

// Night fixtures live in a temp dir; runs/ is read-only and never touched here.
const DATA = '2026-10-29';
const BAD = '2026-10-30';
const EMPTY = '2026-10-31';
const MISSING = '2026-11-01';

const line = (job: string, status: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ at: '2026-10-29T01:00:00+01:00', job, status, owner: 'rook', ...extra });

let runsDir: string;
let config: { adapter: string; installed: string; beatEverySeconds: number; runsDir: string };

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-'));
  config = {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };
  // Written out of job order on purpose: the reader must sort, the views must follow.
  writeFileSync(
    join(runsDir, `${DATA}.jsonl`),
    [
      line('lane/sync', 'ok'),
      line('notes/backup', 'fail', { error: 'quota exceeded', owner: null }),
      line('digest/render', 'ok', { owner: null }),
      line('lane/sync', 'ok', { at: '2026-10-29T02:00:00+01:00' }),
      line('fixtures/refresh', 'retry', { error: 'upstream 503' }),
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(runsDir, `${BAD}.jsonl`),
    [
      line('lane/sync', 'ok'),
      'this is not json',
      line('digest/render', 'ok'),
    ].join('\n'),
  );
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// Job names in the order they appear in the page's table body.
function pageJobs(html: string): string[] {
  const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  return [...body.matchAll(/<tr[^>]*>\s*<td>\s*(?:⚠ )?([^<]+?)\s*<\/td>/g)].map((m) => m[1] ?? '');
}

describe('GET /digest/:night', () => {
  it('200 with a table of jobs for a night with data', async () => {
    const res = await createApp(config).request(`/digest/${DATA}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<table>');
    expect(html).toContain('digest/render');
    expect(html).toContain('fixtures/refresh');
    expect(html).toContain('lane/sync');
    expect(html).toContain('notes/backup');
    expect(html).toContain('quota exceeded');
  });

  it('404 for a night with no file', async () => {
    const res = await createApp(config).request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no run log for this night');
  });

  it('shows "nothing ran" for the empty night', async () => {
    const res = await createApp(config).request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table>');
  });

  it("says 1 line didn't parse and still renders the valid rows", async () => {
    const res = await createApp(config).request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toMatch(/1 line didn(&#39;|')t parse/);
    expect(html).toContain('lane/sync');
    expect(html).toContain('digest/render');
  });
});

describe('GET /api/digest/:night', () => {
  it('200 with rows sorted by job for a night with data', async () => {
    const res = await createApp(config).request(`/api/digest/${DATA}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { night: string; rows: { job: string }[]; badLines: number };
    expect(body.night).toBe(DATA);
    expect(body.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
    ]);
  });

  it('404 with error "no such night" for a night with no file', async () => {
    const res = await createApp(config).request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such night', night: MISSING });
  });

  it('answers rows [] for the empty night', async () => {
    const res = await createApp(config).request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; badLines: number };
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('counts the bad line and keeps the valid rows', async () => {
    const res = await createApp(config).request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { job: string }[]; badLines: number };
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['digest/render', 'lane/sync']);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order', async () => {
    const app = createApp(config);
    const html = await (await app.request(`/digest/${DATA}`)).text();
    const json = (await (await app.request(`/api/digest/${DATA}`)).json()) as {
      rows: { job: string }[];
    };
    const jobs = json.rows.map((r) => r.job);
    expect(jobs.length).toBeGreaterThan(0);
    expect(pageJobs(html)).toEqual(jobs);
  });
});
