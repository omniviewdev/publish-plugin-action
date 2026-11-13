import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { MarketplaceAPI } from './api';

async function withMarketplace(
  response: unknown,
  run: (api: MarketplaceAPI, requests: { path: string; body: unknown }[]) => Promise<void>,
  status = 200
): Promise<void> {
  const requests: { path: string; body: unknown }[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url!, body: body ? JSON.parse(body) : undefined });
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['x-api-key'], 'test-key');
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    await run(new MarketplaceAPI(`http://127.0.0.1:${port}`, 'test-key'), requests);
  } finally {
    await promisify(server.close.bind(server))();
  }
}

for (const envelope of [false, true]) {
  test(`persists requested minimum with ${envelope ? 'wrapped' : 'plain'} response`, async () => {
    const submission = { id: 'submission-1', min_ide_version: '0.11.0' };
    await withMarketplace(envelope ? { data: submission } : submission, async (api, requests) => {
      assert.deepEqual(await api.createSubmission('publisher', 'plugin', '0.9.0', '0.11.0'), submission);
      assert.deepEqual(requests, [{
        path: '/v1/publishers/publisher/submissions',
        body: { plugin_id: 'plugin', version: '0.9.0', min_ide_version: '0.11.0' },
      }]);
    });
  });
}

for (const minimum of [undefined, '']) {
  test(`legacy caller ${minimum === undefined ? 'omits' : 'leaves empty'} minimum`, async () => {
    await withMarketplace({ id: 'legacy' }, async (api, requests) => {
      assert.deepEqual(await api.createSubmission('publisher', 'plugin', '0.9.0', minimum), { id: 'legacy' });
      assert.deepEqual(requests[0].body, { plugin_id: 'plugin', version: '0.9.0' });
    });
  });
}

for (const persisted of [undefined, null, '', '0.10.0']) {
  test(`rejects dropped or changed minimum: ${String(persisted)}`, async () => {
    await withMarketplace({ data: { id: 'unsafe', min_ide_version: persisted } }, async (api, requests) => {
      await assert.rejects(async () => {
        const submission = await api.createSubmission('publisher', 'plugin', '0.9.0', '0.11.0');
        await api.initMultipart(submission.id, 'linux_amd64', 1);
        await api.submitForReview(submission.id);
      }, /did not persist the requested min-ide-version; publishing stopped before artifact upload/);
      assert.equal(requests.length, 1, 'must not generate upload URLs or submit for review');
    });
  });
}

test('preserves API validation errors', async () => {
  await withMarketplace({ error: 'invalid min_ide_version' }, async (api) => {
    await assert.rejects(
      api.createSubmission('publisher', 'plugin', '0.9.0', 'invalid'),
      /API error 400: invalid min_ide_version/
    );
  }, 400);
});

test('includes a non-empty release channel', async () => {
  await withMarketplace({ id: 'feature' }, async (api, requests) => {
    await api.createSubmission('publisher', 'plugin', '0.9.1-feature-abc.7.1', '', 'feature-abc');
    assert.deepEqual(requests[0].body, {
      plugin_id: 'plugin', version: '0.9.1-feature-abc.7.1', channel: 'feature-abc',
    });
  });
});

test('uses multipart marketplace endpoints and preserves part ETags', async () => {
  await withMarketplace({ data: { upload_id: 'upload', part_urls: ['https://storage.example/part'] } }, async (api, requests) => {
    assert.deepEqual(await api.initMultipart('submission', 'linux_amd64', 1), {
      upload_id: 'upload', part_urls: ['https://storage.example/part'],
    });
    await api.completeMultipart('submission', 'linux_amd64', 'upload', [{ part_number: 1, etag: '"etag"' }]);
    await api.abortMultipart('submission', 'linux_amd64', 'upload');
    assert.deepEqual(requests, [
      { path: '/v1/submissions/submission/multipart/init', body: { architecture: 'linux_amd64', part_count: 1 } },
      { path: '/v1/submissions/submission/multipart/complete', body: {
        architecture: 'linux_amd64', upload_id: 'upload', parts: [{ part_number: 1, etag: '"etag"' }],
      } },
      { path: '/v1/submissions/submission/multipart/abort', body: { architecture: 'linux_amd64', upload_id: 'upload' } },
    ]);
  });
});
