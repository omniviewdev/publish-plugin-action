import * as fs from 'fs';
import * as path from 'path';

export async function uploadArtifacts(
  artifactPath: string,
  pluginId: string,
  urls: Record<string, string>
): Promise<void> {
  for (const [arch, url] of Object.entries(urls)) {
    const filename = `${pluginId}-${arch}.tar.gz`;
    const filePath = path.join(artifactPath, filename);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Artifact not found: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    const body = fs.readFileSync(filePath);

    console.log(`Uploading ${filename} (${(stat.size / 1024).toFixed(1)} KB) for ${arch}...`);

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Length': String(stat.size),
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Upload failed for ${arch}: ${res.status} ${text}`);
    }

    console.log(`  Uploaded ${arch} successfully`);
  }
}
