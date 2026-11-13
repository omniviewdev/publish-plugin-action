import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { MarketplaceAPI } from './api';
import { uploadArtifacts } from './upload';

const partSize = 64 * 1024 * 1024;

test('uploads bounded parts with checksums and completes with ordered ETags', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-upload-'));
  const originalFetch = globalThis.fetch;
  const calls: unknown[][] = [];
  try {
    const file = await fs.open(path.join(dir, 'plugin-linux_amd64.tar.gz'), 'w');
    await file.truncate(partSize + 7);
    await file.close();
    const api = {
      initMultipart: async (...args: unknown[]) => {
        calls.push(['init', ...args]);
        return { upload_id: 'upload', part_urls: ['https://storage.example/1', 'https://storage.example/2'] };
      },
      completeMultipart: async (...args: unknown[]) => { calls.push(['complete', ...args]); },
      abortMultipart: async (...args: unknown[]) => { calls.push(['abort', ...args]); },
    } as unknown as MarketplaceAPI;
    globalThis.fetch = async (input, init) => {
      const body = init!.body as Buffer;
      const headers = init!.headers as Record<string, string>;
      assert.equal(headers['Content-Length'], String(body.length));
      assert.equal(headers['Content-MD5'], createHash('md5').update(body).digest('base64'));
      calls.push(['put', String(input), body.length]);
      return new Response(null, { status: 200, headers: { etag: `"part-${calls.length - 1}"` } });
    };
    await uploadArtifacts(dir, 'plugin', ['linux_amd64'], api, 'submission');
    assert.deepEqual(calls, [
      ['init', 'submission', 'linux_amd64', 2],
      ['put', 'https://storage.example/1', partSize],
      ['put', 'https://storage.example/2', 7],
      ['complete', 'submission', 'linux_amd64', 'upload', [
        { part_number: 1, etag: '"part-1"' }, { part_number: 2, etag: '"part-2"' },
      ]],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

for (const failure of ['put', 'etag', 'complete', 'urls'] as const) {
  test(`aborts multipart upload after ${failure} failure`, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-upload-'));
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    try {
      await fs.writeFile(path.join(dir, 'plugin-linux_amd64.tar.gz'), 'artifact');
      const api = {
        initMultipart: async () => ({ upload_id: 'upload', part_urls: failure === 'urls' ? [] : ['https://storage.example/1'] }),
        completeMultipart: async () => { calls.push('complete'); if (failure === 'complete') throw new Error('complete failed'); },
        abortMultipart: async (_submission: string, _arch: string, id: string) => { calls.push(`abort:${id}`); },
      } as unknown as MarketplaceAPI;
      globalThis.fetch = async () => new Response(null, {
        status: failure === 'put' ? 500 : 200,
        headers: failure === 'etag' ? {} : { etag: '"etag"' },
      });
      await assert.rejects(uploadArtifacts(dir, 'plugin', ['linux_amd64'], api, 'submission'));
      assert.deepEqual(calls, failure === 'complete' ? ['complete', 'abort:upload'] : ['abort:upload']);
    } finally {
      globalThis.fetch = originalFetch;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}
