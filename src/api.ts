export class MarketplaceAPI {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json',
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      const msg = json.error || json.message || `Request failed (${res.status})`;
      throw new Error(`API error ${res.status}: ${msg}`);
    }

    return ('data' in json ? json.data : json) as T;
  }

  async createSubmission(
    publisherSlug: string,
    pluginId: string,
    version: string,
    minIdeVersion?: string,
    channel?: string
  ): Promise<{ id: string; min_ide_version?: string }> {
    const submission = await this.request<{ id: string; min_ide_version?: string }>(
      'POST',
      `/v1/publishers/${publisherSlug}/submissions`,
      {
        plugin_id: pluginId,
        version,
        ...(minIdeVersion ? { min_ide_version: minIdeVersion } : {}),
        ...(channel ? { channel } : {}),
      }
    );
    if (minIdeVersion && submission.min_ide_version !== minIdeVersion) {
      throw new Error(
        'Marketplace did not persist the requested min-ide-version; publishing stopped before artifact upload. ' +
          'Use a marketplace server that supports min_ide_version.'
      );
    }
    return submission;
  }

  async initMultipart(submissionId: string, architecture: string, partCount: number): Promise<{ upload_id: string; part_urls: string[] }> {
    return this.request('POST', `/v1/submissions/${submissionId}/multipart/init`, {
      architecture, part_count: partCount,
    });
  }

  async completeMultipart(submissionId: string, architecture: string, uploadId: string, parts: { part_number: number; etag: string }[]): Promise<void> {
    await this.request('POST', `/v1/submissions/${submissionId}/multipart/complete`, {
      architecture, upload_id: uploadId, parts,
    });
  }

  async abortMultipart(submissionId: string, architecture: string, uploadId: string): Promise<void> {
    await this.request('POST', `/v1/submissions/${submissionId}/multipart/abort`, {
      architecture, upload_id: uploadId,
    });
  }

  async submitForReview(submissionId: string): Promise<{ id: string; status: string }> {
    return this.request('POST', `/v1/submissions/${submissionId}/submit`);
  }

  async getSubmission(submissionId: string): Promise<{ id: string; status: string }> {
    return this.request('GET', `/v1/submissions/${submissionId}`);
  }
}
