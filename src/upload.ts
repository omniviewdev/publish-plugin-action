import * as fs from 'fs';
import * as path from 'path';

async function uploadOne(
  artifactPath: string,
  pluginId: string,
  arch: string,
  url: string
): Promise<void> {
  const filename = `${pluginId}-${arch}.tar.gz`;
  const filePath = path.join(artifactPath, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Artifact not found: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  const body = fs.readFileSync(filePath);

  // Log the URL host (not the full signed URL which contains secrets)
  let urlHost: string;
  try {
    urlHost = new URL(url).host;
  } catch {
    throw new Error(`Invalid upload URL for ${arch}: ${url}`);
  }

  console.log(`Uploading ${filename} (${(stat.size / 1024).toFixed(1)} KB) for ${arch} to ${urlHost}...`);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Length': String(stat.size),
      },
      body,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Upload fetch failed for ${arch} (host: ${urlHost}): ${msg}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed for ${arch}: HTTP ${res.status} ${res.statusText} — ${text}`);
  }

  console.log(`  Uploaded ${arch} successfully`);
}

export async function uploadArtifacts(
  artifactPath: string,
  pluginId: string,
  urls: Record<string, string>
): Promise<void> {
  const uploads = Object.entries(urls).map(([arch, url]) =>
    uploadOne(artifactPath, pluginId, arch, url)
  );
  await Promise.all(uploads);
}
