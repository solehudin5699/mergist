#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { loadConfig, saveConfig } from './config.js';
import { defaultTemplate, githubTemplate } from './templates/default.js';
import { buildSystemMessage, PROMPT_TEMPLATE } from './prompts.js';
import { GitLabGenerator } from './generators/gitlab.js';
import { GitHubGenerator } from './generators/github.js';
import { OpenAIProvider } from './providers/openai.js';
import type { Platform, Config } from './types.js';

const program = new Command();

program
  .name('mr-describe')
  .description('AI-powered Merge Request description generator')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize mr-describe in your project')
  .option('-p, --platform <platform>', 'Platform to add (gitlab/github)', 'gitlab')
  .option('-m, --model <model>', 'AI model', 'gpt-4o')
  .option('-d, --max-diff <number>', 'Max diff characters', '8000')
  .action(async (opts) => {
    const platform = opts.platform as Platform;
    const cwd = process.cwd();
    const configPath = resolve(cwd, '.mr-describerc');

    console.log(`\n🆕 Initializing mr-describe for ${platform}...\n`);

    let config: Config;
    if (existsSync(configPath)) {
      config = loadConfig(cwd);
      console.log('📄 Existing config loaded.');
    } else {
      config = {
        platforms: [],
        aiProvider: 'openai' as const,
        model: opts.model,
        maxDiffChars: parseInt(opts.maxDiff),
        providers: {
          openai: { apiKey: 'env:OPENAI_API_KEY', model: opts.model },
        },
      };
    }

    if (!config.platforms.includes(platform)) {
      config.platforms.push(platform);
    }

    const mrDescribeDir = resolve(cwd, '.mr-describe', platform);
    mkdirSync(mrDescribeDir, { recursive: true });

    if (platform === 'gitlab') {
      writeFileSync(resolve(mrDescribeDir, 'generate-mr-desc.js'), generateGitLabScript(config));
      writeFileSync(resolve(cwd, '.gitlab-ci.yml'), generateGitLabCI());
      mkdirSync(resolve(cwd, '.gitlab', 'merge_request_templates'), { recursive: true });
      writeFileSync(
        resolve(cwd, '.gitlab', 'merge_request_templates', 'Default.md'),
        defaultTemplate,
      );
    } else if (platform === 'github') {
      writeFileSync(resolve(mrDescribeDir, 'generate-pr-desc.js'), generateGitHubScript(config));
      mkdirSync(resolve(cwd, '.github', 'workflows'), { recursive: true });
      writeFileSync(
        resolve(cwd, '.github', 'workflows', 'mr-describe.yml'),
        generateGitHubWorkflow(),
      );
      mkdirSync(resolve(cwd, '.github'), { recursive: true });
      writeFileSync(resolve(cwd, '.github', 'PULL_REQUEST_TEMPLATE.md'), githubTemplate);
    }

    saveConfig(config, cwd);

    console.log(`\n✅ Successfully initialized mr-describe for ${platform}!`);
    console.log('\n📝 Next steps:');
    console.log('1. Set your API key in CI secrets (OPENAI_API_KEY)');
    console.log('2. Commit the generated files');
    console.log('3. Create a merge request to test');
  });

program
  .command('generate')
  .description('Generate MR/PR description (for CI)')
  .option('-p, --platform <platform>', 'Platform (gitlab/github)', 'gitlab')
  .action(async (opts) => {
    const platform = opts.platform as Platform;
    const config = loadConfig();

    const apiKey = getApiKey(config);
    if (!apiKey) {
      console.error('❌ API key not found. Set OPENAI_API_KEY env variable.');
      process.exit(1);
    }

    const provider = new OpenAIProvider(apiKey, config.providers.openai?.model || 'gpt-4o');

    const template = platform === 'gitlab' ? defaultTemplate : githubTemplate;

    if (platform === 'gitlab') {
      const token = process.env.GITLAB_TOKEN;
      const projectId = process.env.CI_PROJECT_ID;
      const mrIid = process.env.CI_MERGE_REQUEST_IID;
      const baseUrl = process.env.GITLAB_API_V4_URL || 'https://gitlab.com/api/v4';

      if (!token || !projectId || !mrIid) {
        console.error(
          '❌ Missing required CI variables (GITLAB_TOKEN, CI_PROJECT_ID, CI_MERGE_REQUEST_IID)',
        );
        process.exit(1);
      }

      const generator = new GitLabGenerator(token, projectId, mrIid, baseUrl, provider, template);
      await generator.generate();
    } else if (platform === 'github') {
      const token = process.env.GITHUB_TOKEN;
      const owner = process.env.GITHUB_REPOSITORY_OWNER;
      const repoParts = process.env.GITHUB_REPOSITORY?.split('/');
      const repo = repoParts?.[1];
      const prNumber = process.env.GITHUB_PR_NUMBER;

      if (!token || !owner || !repo || !prNumber) {
        console.error(
          '❌ Missing required CI variables (GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_PR_NUMBER)',
        );
        process.exit(1);
      }

      const generator = new GitHubGenerator(
        token,
        owner,
        repo,
        prNumber,
        'https://api.github.com',
        provider,
        template,
      );
      await generator.generate();
    }
  });

const configCmd = program.command('config').description('Show or edit configuration');

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig();
    console.log('\n📋 Current Configuration:\n');
    console.log(JSON.stringify(config, null, 2));
    console.log('');
  });

configCmd
  .command('get <key>')
  .description('Get a config value')
  .action((key: string) => {
    const config = loadConfig();
    const value = (config as unknown as Record<string, unknown>)[key];
    if (value === undefined) {
      console.error(`❌ Unknown key: ${key}`);
      process.exit(1);
    }
    console.log(value);
  });

configCmd
  .command('set <key> <value>')
  .description('Set a config value')
  .action((key: string, value: string) => {
    const config = loadConfig();

    if (key === 'platforms') {
      const platforms = value.split(',').map((p) => p.trim()) as Platform[];
      config.platforms = platforms.filter((p) => p === 'gitlab' || p === 'github');
    } else if (key === 'model') {
      config.model = value;
    } else if (key === 'maxDiffChars') {
      config.maxDiffChars = parseInt(value, 10);
    } else if (key === 'aiProvider') {
      if (value !== 'openai') {
        console.error('❌ Only openai is supported');
        process.exit(1);
      }
      config.aiProvider = value as 'openai';
    } else {
      console.error(`❌ Unknown key: ${key}`);
      console.log('Available keys: platforms, model, maxDiffChars, aiProvider');
      process.exit(1);
    }

    saveConfig(config);
    console.log(`✅ Updated ${key} = ${value}`);
  });

program.parse();

function getApiKey(config: Config): string | null {
  const provider = config.providers[config.aiProvider];
  if (!provider?.apiKey) return null;

  if (provider.apiKey.startsWith('env:')) {
    const envVar = provider.apiKey.slice(4);
    return process.env[envVar] || null;
  }

  return provider.apiKey;
}

function generateGitLabScript(config: Config): string {
  const systemMessage = buildSystemMessage('mr');
  const generatedPrompt = PROMPT_TEMPLATE.replace(/__LABEL__/g, 'MR')
    .replace('__TITLE__', '${mrInfo.title}')
    .replace('__TEMPLATE__', '${TEMPLATE}');

  return `/**
 * generate-mr-desc.js
 * Auto-generate GitLab MR description using OpenAI
 */

const https = require('https');

const { GITLAB_TOKEN, CI_PROJECT_ID, CI_MERGE_REQUEST_IID, GITLAB_API_V4_URL, OPENAI_API_KEY } = process.env;

const MODEL = '${config.model}';
const MAX_DIFF_CHARS = ${config.maxDiffChars};
const SYSTEM_MESSAGE = ${JSON.stringify(systemMessage)};

const TEMPLATE = \`${defaultTemplate.replace(/`/g, '\\`')}\`;

function httpRequest(url, options, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(url, { ...options, headers: { ...options.headers, 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function getHeaders() {
  return { 'Content-Type': 'application/json', 'PRIVATE-TOKEN': GITLAB_TOKEN };
}

async function getMRInfo() {
  const url = \`\${GITLAB_API_V4_URL}/projects/\${CI_PROJECT_ID}/merge_requests/\${CI_MERGE_REQUEST_IID}\`;
  const res = await httpRequest(url, { method: 'GET', headers: getHeaders() });
  if (res.status !== 200) throw new Error(\`Failed to get MR info (HTTP \${res.status})\`);
  return res.body;
}

async function getMRDiff() {
  const url = \`\${GITLAB_API_V4_URL}/projects/\${CI_PROJECT_ID}/merge_requests/\${CI_MERGE_REQUEST_IID}/diffs\`;
  const res = await httpRequest(url, { method: 'GET', headers: getHeaders() });
  if (res.status !== 200) throw new Error(\`Failed to get MR diff (HTTP \${res.status})\`);
  return res.body.map((f) => \`--- \${f.old_path}\\n+++ \${f.new_path}\\n\${f.diff}\`).join('\\n\\n');
}

async function updateMRDescription(desc) {
  const url = \`\${GITLAB_API_V4_URL}/projects/\${CI_PROJECT_ID}/merge_requests/\${CI_MERGE_REQUEST_IID}\`;
  const res = await httpRequest(url, { method: 'PUT', headers: getHeaders() }, { description: desc });
  if (res.status !== 200) throw new Error(\`Failed to update MR (HTTP \${res.status})\`);
}

async function callAI(prompt, diff) {
  const res = await httpRequest('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${OPENAI_API_KEY}\` }
  }, { model: MODEL, max_tokens: 1000, messages: [{ role: 'system', content: SYSTEM_MESSAGE }, { role: 'user', content: prompt + '\\n\\nGIT DIFF:\\n' + diff.slice(0, MAX_DIFF_CHARS) }] });
  if (res.status !== 200) throw new Error(\`AI error (HTTP \${res.status})\`);
  return res.body.choices[0]?.message?.content?.trim() || '';
}

async function main() {
  console.log('[MR Generator] Memulai...');
  const mrInfo = await getMRInfo();
  if (mrInfo.description?.trim()) { console.log('[MR Generator] Deskripsi sudah ada, dilewati.'); return; }
  const diff = await getMRDiff();
  if (!diff.trim()) { console.log('[MR Generator] Tidak ada diff, dilewati.'); return; }
  const prompt = \`${generatedPrompt}\`;
  const desc = await callAI(prompt, diff);
  await updateMRDescription(desc);
  console.log('[MR Generator] ✓ Deskripsi berhasil diupdate!');
}

main().catch(err => { console.error('[MR Generator] ✗', err.message); process.exit(0); });`;
}

function generateGitLabCI(): string {
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
    - cd .mr-describe/gitlab
    - node generate-mr-desc.js
  allow_failure: true
`;
}

function generateGitHubScript(config: Config): string {
  const systemMessage = buildSystemMessage('pr');
  const generatedPrompt = PROMPT_TEMPLATE.replace(/__LABEL__/g, 'PR')
    .replace('__TITLE__', '${prInfo.title}')
    .replace('__TEMPLATE__', '${TEMPLATE}');

  return `/**
 * generate-pr-desc.js
 * Auto-generate GitHub PR description using OpenAI
 */

const https = require('https');

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_PR_NUMBER, OPENAI_API_KEY } = process.env;
const [OWNER, REPO] = GITHUB_REPOSITORY.split('/');

const MODEL = '${config.model}';
const MAX_DIFF_CHARS = ${config.maxDiffChars};
const SYSTEM_MESSAGE = ${JSON.stringify(systemMessage)};

const TEMPLATE = \`${githubTemplate.replace(/`/g, '\\`')}\`;

function httpRequest(url, options, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(url, { ...options, headers: { ...options.headers, 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getPRInfo() {
  const res = await httpRequest(\`https://api.github.com/repos/\${OWNER}/\${REPO}/pulls/\${GITHUB_PR_NUMBER}\`, {
    method: 'GET',
    headers: { 'Authorization': \`Bearer \${GITHUB_TOKEN}\`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (res.status !== 200) throw new Error(\`Failed to get PR info (HTTP \${res.status})\`);
  return res.body;
}

async function getPRDiff() {
  const res = await httpRequest(\`https://api.github.com/repos/\${OWNER}/\${REPO}/pulls/\${GITHUB_PR_NUMBER}/files\`, {
    method: 'GET',
    headers: { 'Authorization': \`Bearer \${GITHUB_TOKEN}\`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (res.status !== 200) throw new Error(\`Failed to get PR diff (HTTP \${res.status})\`);
  return res.body.map(f => f.patch ? \`--- \${f.filename}\\n+++ \${f.filename}\\n\${f.patch}\` : '').filter(Boolean).join('\\n\\n');
}

async function updatePRDescription(desc) {
  await httpRequest(\`https://api.github.com/repos/\${OWNER}/\${REPO}/pulls/\${GITHUB_PR_NUMBER}\`, {
    method: 'PATCH',
    headers: { 'Authorization': \`Bearer \${GITHUB_TOKEN}\`, 'Accept': 'application/vnd.github.v3+json' }
  }, { body: desc });
}

async function callAI(prompt, diff) {
  const res = await httpRequest('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${OPENAI_API_KEY}\` }
  }, { model: MODEL, max_tokens: 1000, messages: [{ role: 'system', content: SYSTEM_MESSAGE }, { role: 'user', content: prompt + '\\n\\nGIT DIFF:\\n' + diff.slice(0, MAX_DIFF_CHARS) }] });
  if (res.status !== 200) throw new Error(\`AI error (HTTP \${res.status})\`);
  return res.body.choices[0]?.message?.content?.trim() || '';
}

async function main() {
  console.log('[PR Generator] Memulai...');
  const prInfo = await getPRInfo();
  if (prInfo.body?.trim()) { console.log('[PR Generator] Deskripsi sudah ada, dilewati.'); return; }
  const diff = await getPRDiff();
  if (!diff.trim()) { console.log('[PR Generator] Tidak ada diff, dilewati.'); return; }
  const prompt = \`${generatedPrompt}\`;
  const desc = await callAI(prompt, diff);
  await updatePRDescription(desc);
  console.log('[PR Generator] ✓ Deskripsi berhasil diupdate!');
}

main().catch(err => { console.error('[PR Generator] ✗', err.message); process.exit(0); });`;
}

function generateGitHubWorkflow(): string {
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
          cd .mr-describe/github
          node generate-pr-desc.js
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
`;
}
