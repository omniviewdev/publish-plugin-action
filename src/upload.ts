import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { MarketplaceAPI } from './api';

const PART_SIZE = 64 * 1024 * 1024;
const MAX_PARTS = 10000;

async function uploadOne(
  artifactPath: string,
  pluginId: string,
  arch: string,
  api: MarketplaceAPI,
  submissionId: string
): Promise<void> {
  const filename = `${pluginId}-${arch}.tar.gz`;
  const filePath = path.join(artifactPath, filename);
  const file = await fs.promises.open(filePath, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Artifact must be a non-empty regular file: ${filePath}`);
    }
    const partCount = Math.ceil(stat.size / PART_SIZE);
    if (partCount > MAX_PARTS) {
      throw new Error(`Artifact exceeds multipart limit: ${filePath}`);
    }

    const { upload_id: uploadId, part_urls: urls } = await api.initMultipart(submissionId, arch, partCount);
    if (typeof uploadId !== 'string' || !uploadId) {
      throw new Error(`Marketplace returned an invalid upload ID for ${arch}`);
    }
    try {
      if (!Array.isArray(urls) || urls.length !== partCount) {
        throw new Error(`Marketplace returned an invalid part URL count for ${arch}`);
      }
      const parts: { part_number: number; etag: string }[] = [];
      console.log(`Uploading ${filename} (${(stat.size / 1024).toFixed(1)} KB) in ${partCount} part(s)...`);
      for (let i = 0; i < partCount; i++) {
        let url: URL;
        try {
          url = new URL(urls[i]);
          if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('invalid protocol');
        } catch {
          throw new Error(`Invalid upload URL for ${arch} part ${i + 1}`);
        }
        const length = Math.min(PART_SIZE, stat.size - i * PART_SIZE);
        const body = Buffer.allocUnsafe(length);
        let offset = 0;
        while (offset < length) {
          const { bytesRead } = await file.read(body, offset, length - offset, i * PART_SIZE + offset);
          if (bytesRead === 0) throw new Error(`Artifact changed during upload: ${filePath}`);
          offset += bytesRead;
        }
        const checksum = createHash('md5').update(body).digest('base64');
        let res: Response;
        try {
          res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Length': String(length), 'Content-MD5': checksum },
            body,
          });
        } catch {
          throw new Error(`Upload fetch failed for ${arch} part ${i + 1} (host: ${url.host})`);
        }
        if (!res.ok) {
          throw new Error(`Upload failed for ${arch} part ${i + 1}: HTTP ${res.status} ${res.statusText}`);
        }
        const etag = res.headers.get('etag');
        if (!etag) throw new Error(`Upload returned no ETag for ${arch} part ${i + 1}`);
        parts.push({ part_number: i + 1, etag });
      }
      const finalStat = await file.stat();
      if (finalStat.size !== stat.size || finalStat.mtimeMs !== stat.mtimeMs) {
        throw new Error(`Artifact changed during upload: ${filePath}`);
      }
      await api.completeMultipart(submissionId, arch, uploadId, parts);
      console.log(`  Uploaded ${arch} successfully`);
    } catch (err) {
      try {
        await api.abortMultipart(submissionId, arch, uploadId);
      } catch {
        console.warn(`Failed to abort multipart upload for ${arch}`);
      }
      throw err;
    }
  } finally {
    await file.close();
  }
}

export async function uploadArtifacts(
  artifactPath: string,
  pluginId: string,
  architectures: string[],
  api: MarketplaceAPI,
  submissionId: string
): Promise<void> {
  // Sequential artifacts and parts keep memory and concurrent requests bounded.
  for (const arch of architectures) {
    await uploadOne(artifactPath, pluginId, arch, api, submissionId);
  }
}
