import * as core from '@actions/core';
import { MarketplaceAPI } from './api';
import { uploadArtifacts } from './upload';
import { pollForApproval } from './poll';

async function run(): Promise<void> {
  try {
    // Read inputs
    const apiKey = core.getInput('api-key', { required: true });
    const apiUrl = core.getInput('api-url');
    const publisherSlug = core.getInput('publisher-slug', { required: true });
    const pluginId = core.getInput('plugin-id', { required: true });
    const version = core.getInput('version', { required: true }).replace(/^v/, '');
    const artifactPath = core.getInput('artifact-path', { required: true });
    const architectures = core
      .getInput('architectures', { required: true })
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const waitForApproval = core.getInput('wait-for-approval') === 'true';
    const pollTimeout = parseInt(core.getInput('poll-timeout'), 10) || 600;

    if (architectures.length === 0) {
      throw new Error('At least one architecture must be specified');
    }

    const api = new MarketplaceAPI(apiUrl, apiKey);

    // Step 1: Create submission
    core.info(`Creating submission for ${pluginId}@${version}...`);
    const submission = await api.createSubmission(publisherSlug, pluginId, version);
    const submissionId = submission.id;
    core.setOutput('submission-id', submissionId);
    core.info(`  Submission created: ${submissionId}`);

    // Step 2: Generate upload URLs
    core.info(`Generating upload URLs for ${architectures.join(', ')}...`);
    const { urls } = await api.generateUploadUrls(submissionId, architectures);

    // Step 3: Upload artifacts
    core.info('Uploading artifacts...');
    await uploadArtifacts(artifactPath, pluginId, urls);

    // Step 4: Submit for review
    core.info('Submitting for review...');
    const result = await api.submitForReview(submissionId);
    core.info(`  Submission status: ${result.status}`);

    // Step 5: Optionally poll for approval
    if (waitForApproval) {
      const finalStatus = await pollForApproval(api, submissionId, pollTimeout);
      core.setOutput('status', finalStatus);

      if (finalStatus === 'rejected') {
        core.setFailed(`Submission was rejected`);
      } else {
        core.info(`Submission ${finalStatus}`);
      }
    } else {
      core.setOutput('status', result.status);
      core.info('Submission submitted for review. Use wait-for-approval to poll for result.');
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

run();
