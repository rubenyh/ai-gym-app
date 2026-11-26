// Branch tests for scripts/supabase-ready.sh with stubbed `supabase`, `docker`, `curl` and `sleep` on PATH.
// No Docker or Supabase needed:  node --test scripts/supabase-ready.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'supabase-ready.sh');

/**
 * mode: 'healthy' | 'recovers' (502 until Kong restarts) | 'broken' (502 always)
 * Logs every docker/curl/sleep call to calls.log in a fresh temp dir.
 */
function run(mode, { apiUrl = 'http://127.0.0.1:54321', kong = 'supabase_kong_test' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ready-'));
  const log = join(dir, 'calls.log');
  const stub = (name, body) => {
    const p = join(dir, name);
    writeFileSync(p, `#!/usr/bin/env bash\necho "${name} $*" >> "${log.replace(/\\/g, '/')}"\n${body}\n`);
    chmodSync(p, 0o755);
  };
  const flag = join(dir, 'restarted').replace(/\\/g, '/');
  stub('supabase', `printf 'API_URL="${apiUrl}"\\nANON_KEY="anon"\\n'`);
  stub('docker', `if [ "$1" = ps ]; then ${kong ? `echo ${kong}` : 'true'}; elif [ "$1" = restart ]; then touch "${flag}"; fi`);
  stub('curl', {
    healthy: 'printf 200',
    recovers: `if [ -e "${flag}" ]; then printf 200; else printf 502; fi`,
    broken: 'printf 502',
  }[mode]);
  stub('sleep', 'true');
  // Git Bash on Windows understands POSIX paths; convert C:\x to /c/x.
  const posix = (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
  const res = spawnSync('bash', ['-c', `PATH="${posix(dir)}:$PATH" bash "${posix(script)}"`], { encoding: 'utf8' });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  return { code: res.status, out: res.stdout + res.stderr, calls };
}

const count = (calls, prefix) => calls.filter((c) => c.startsWith(prefix)).length;

test('healthy stack: exits 0 without restarting Kong', () => {
  const r = run('healthy');
  assert.equal(r.code, 0, r.out);
  assert.equal(count(r.calls, 'docker restart'), 0);
});

test('502 that clears after a restart: exactly one Kong restart, exits 0', () => {
  const r = run('recovers');
  assert.equal(r.code, 0, r.out);
  assert.equal(count(r.calls, 'docker restart supabase_kong_test'), 1);
  assert.match(r.out, /ok after Kong restart/);
});

test('persistent 502: one restart, bounded re-probes, exits 1 with guidance', () => {
  const r = run('broken');
  assert.equal(r.code, 1, r.out);
  assert.equal(count(r.calls, 'docker restart'), 1);
  assert.equal(count(r.calls, 'sleep'), 10);
  assert.equal(count(r.calls, 'curl'), 2 * 11); // initial probe + 10 re-probes, two endpoints each
  assert.match(r.out, /still failing after Kong restart/);
});

test('no Kong container: exits 1 without restarting anything', () => {
  const r = run('broken', { kong: '' });
  assert.equal(r.code, 1, r.out);
  assert.equal(count(r.calls, 'docker restart'), 0);
  assert.match(r.out, /no supabase_kong_\* container/);
});

test('non-local API URL: refuses before probing', () => {
  const r = run('healthy', { apiUrl: 'https://abc.supabase.co' });
  assert.equal(r.code, 1, r.out);
  assert.equal(count(r.calls, 'curl'), 0);
  assert.match(r.out, /refusing non-local/);
});
