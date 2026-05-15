import type { Config } from '../types.js';

export function generateGitLabCI(generateScript: boolean): string {
  return `stages:
  - ai-mr

generate-mr-description:
  stage: ai-mr
  image: node:20-alpine
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    GIT_DEPTH: 0
  script:
    - ${generateScript ? 'cd .mr-describe/gitlab && node generate-mr-desc.js' : 'npx mr-describe generate -p gitlab'}
  allow_failure: true
`;
}

export function generateGitHubWorkflow(generateScript: boolean, config: Config): string {
  const providerKey = config.aiProvider || 'openai';
  const providerCfg = config.providers[providerKey] || { apiKey: 'env:AI_API_KEY' };
  const envVarName = providerCfg.apiKey?.replace(/^env:/, '') || 'AI_API_KEY';

  return `name: Generate PR Description

on:
  pull_request:
    types: [opened, synchronize]
  workflow_dispatch:

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Generate PR Description
        run: |
          ${generateScript ? 'cd .mr-describe/github && node generate-pr-desc.js' : 'npx mr-describe generate -p github'}
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_PR_NUMBER: \${{ github.event.number }}
          ${envVarName}: \${{ secrets.${envVarName} }}
`;
}
