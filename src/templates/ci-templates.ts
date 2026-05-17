import type { Config } from '../types.js';

export function generateGitLabCI(generateScript: boolean, config: Config): string {
  const branches = config.ciTargetBranches;
  const rules = branches?.length
    ? `rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_TARGET_BRANCH_NAME =~ /^(${branches.join('|')})$/'`
    : `rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"`;

  return `stages:
  - mergist

mergist:
  stage: mergist
  image: node:20-alpine
  ${rules}
  variables:
    GIT_DEPTH: 0
  script:
    - ${generateScript ? 'cd .mergist/gitlab && node generate.js' : 'npx mergist generate -p gitlab'}
  allow_failure: true
`;
}

export function generateGitHubWorkflow(generateScript: boolean, config: Config): string {
  const providerKey = config.aiProvider || 'openai';
  const providerCfg = config.providers[providerKey] || { apiKey: 'env:AI_API_KEY' };
  const envVarName = providerCfg.apiKey?.replace(/^env:/, '') || 'AI_API_KEY';

  const branches = config.ciTargetBranches;
  const branchesYaml = branches?.length
    ? `\n    branches:\n${branches.map(b => `      - ${b}`).join('\n')}`
    : '';

  return `name: Generate PR Description

on:
  pull_request:
    types: [opened, synchronize]${branchesYaml}
  workflow_dispatch:

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Generate PR Description
        run: |
          ${generateScript ? 'cd .mergist/github && node generate.js' : 'npx mergist generate -p github'}
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_PR_NUMBER: \${{ github.event.number }}
          ${envVarName}: \${{ secrets.${envVarName} }}
`;
}
