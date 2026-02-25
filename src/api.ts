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

  async createSubmission(publisherSlug: string, pluginId: string, version: string): Promise<{ id: string }> {
    return this.request('POST', `/v1/publishers/${publisherSlug}/submissions`, {
      plugin_id: pluginId,
      version,
    });
  }

  async generateUploadUrls(
    submissionId: string,
    architectures: string[]
  ): Promise<{ urls: Record<string, string> }> {
    return this.request('POST', `/v1/submissions/${submissionId}/upload-urls`, {
      architectures,
    });
  }

  async submitForReview(submissionId: string): Promise<{ id: string; status: string }> {
    return this.request('POST', `/v1/submissions/${submissionId}/submit`);
  }

  async getSubmission(submissionId: string): Promise<{ id: string; status: string }> {
    return this.request('GET', `/v1/submissions/${submissionId}`);
  }
}
