import { MarketplaceAPI } from './api';

const TERMINAL_STATUSES = ['approved', 'rejected', 'withdrawn'];

export async function pollForApproval(
  api: MarketplaceAPI,
  submissionId: string,
  timeoutSeconds: number
): Promise<string> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let delay = 5000; // Start with 5s

  console.log(`Polling for submission ${submissionId} approval (timeout: ${timeoutSeconds}s)...`);

  while (Date.now() < deadline) {
    await sleep(delay);

    const sub = await api.getSubmission(submissionId);
    console.log(`  Status: ${sub.status}`);

    if (TERMINAL_STATUSES.includes(sub.status)) {
      return sub.status;
    }

    // Exponential backoff, capped at 30s
    delay = Math.min(delay * 1.5, 30000);
  }

  throw new Error(`Timed out waiting for approval after ${timeoutSeconds}s`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
