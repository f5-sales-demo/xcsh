'use strict';

const { requestGitHubApi } = require('./github-api-resilience.cjs');

async function enableImmutableReleases(options = {}) {
  const repository = options.repository ?? process.env.REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) {
    throw new Error('A valid owner/repository is required');
  }
  const endpoint = `repos/${repository}/immutable-releases`;
  const requestOptions = {
    maxAttempts: 5,
    totalWaitBudgetSeconds: 300,
    ...options,
    token: options.token ?? process.env.GH_TOKEN,
  };
  await requestGitHubApi(endpoint, {
    ...requestOptions, method: 'PUT', operationName: 'Enable immutable releases',
  });
  const state = await requestGitHubApi(endpoint, {
    ...requestOptions, method: 'GET', operationName: 'Verify immutable releases',
  });
  if (state?.enabled !== true) {
    throw new Error('Repository release immutability must be enabled before tagging');
  }
}

module.exports = { enableImmutableReleases };
if (require.main === module) {
  enableImmutableReleases().catch(error => {
    // Do not emit API bodies, credentials or request metadata into workflow logs.
    const exhausted = error?.name === 'GitHubRetryDeferredError';
    console.error(exhausted
      ? '::error::Immutable release gate exhausted its bounded GitHub retries; retry this workflow after the API cooldown'
      : '::error::Immutable release gate failed; verify release-token permissions and repository immutability');
    process.exitCode = 1;
  });
}
