import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve(process.cwd(), 'resolve-channel/resolve.sh');

test('resolves only promoted channels with reachable stable tags', () => {
  const dir = mkdtempSync(join(tmpdir(), 'channel-resolve-'));
  const runGit = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  const fixture = join(dir, 'channels.json');
  const output = join(dir, 'output');
  const run = (branch: string, status: string) => {
    writeFileSync(fixture, JSON.stringify({ channels: [{ channel: 'feature-abc', branch: 'feature/abc', status }] }));
    writeFileSync(output, '');
    const result = spawnSync('bash', [script], { cwd: dir, encoding: 'utf8', env: {
      ...process.env, GITHUB_REF: `refs/heads/${branch}`, GITHUB_OUTPUT: output,
      CHANNEL_KIND: 'host', CHANNELS_URL: `file://${fixture}`, COMPUTE_VERSION: 'true',
      GITHUB_RUN_NUMBER: '7', GITHUB_RUN_ATTEMPT: '1',
    } });
    return { result, output: readFileSync(output, 'utf8') };
  };
  try {
    runGit('init');
    runGit('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'initial');
    const missing = run('feature/abc', 'active');
    assert.notEqual(missing.result.status, 0);
    assert.match(missing.result.stdout, /no stable vX.Y.Z tag reachable/);
    runGit('tag', 'v0.4.0');
    runGit('tag', 'v0.5.0');
    const active = run('feature/abc', 'active');
    assert.equal(active.result.status, 0, active.result.stderr);
    assert.match(active.output, /enabled=true\nchannel=feature-abc\nversion=0\.5\.1-feature-abc\.7\.1/);
    assert.doesNotMatch(run('main', 'active').output, /enabled=true/);
    assert.doesNotMatch(run('feature/abc', 'archived').output, /enabled=true/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
