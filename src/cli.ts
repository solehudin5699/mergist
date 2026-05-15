#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
import { intro, outro, select, confirm, text, multiselect, isCancel } from '@clack/prompts';
import { loadConfig, saveConfig, getConfigPath } from './config.js';
import { buildTemplate } from './templates/default.js';
import { buildSystemMessage, buildPromptScriptTemplate } from './prompts.js';
import { GitLabGenerator } from './generators/gitlab.js';
import { GitHubGenerator } from './generators/github.js';
import { OpenAIProvider } from './providers/openai.js';
import type { Platform, Language, Config, Section } from './types.js';

const program = new Command();

program.name(pkg.name).description(pkg.description).version(pkg.version);

program
  .command('init')
  .description('Initialize mr-describe in your project')
  .action(async () => {
    const cwd = process.cwd();

    intro(`${pkg.name} v${pkg.version}\n${pkg.description}`);

    const platform = (await select({
      message: 'Select platform',
      options: [
        { value: 'gitlab', label: 'GitLab' },
        { value: 'github', label: 'GitHub' },
      ],
      initialValue: 'gitlab',
    })) as Platform;
    if (isCancel(platform)) { outro('Cancelled.'); process.exit(0); }

    const existingConfig = loadConfig(cwd);
    const configExists = existsSync(getConfigPath(cwd));

    if (configExists && existingConfig.platforms.includes(platform)) {
      const reinitResult = await confirm({
        message: `Platform "${platform}" is already configured. Reinitialize?`,
        initialValue: false,
      });
      if (isCancel(reinitResult)) { outro('Cancelled.'); process.exit(0); }
      if (!reinitResult) { outro('Cancelled.'); process.exit(0); }
    }

    const scriptResult = await confirm({
      message: 'Generate standalone script (no npx dependency)?',
      initialValue: false,
    });
    if (isCancel(scriptResult)) process.exit(0);
    const generateScript = scriptResult as boolean;

    let model = existingConfig.model;
    let maxDiffChars = existingConfig.maxDiffChars;
    let lang: Language = existingConfig.lang;

    let reconfig = false;
    if (configExists) {
      const reconfigResult = await confirm({
        message: '.mr-describerc already exists. Reconfigure?',
        initialValue: false,
      });
      if (isCancel(reconfigResult)) process.exit(0);
      reconfig = reconfigResult as boolean;
    }

    if (!configExists || reconfig) {
      const modelResult = await text({
        message: 'AI model',
        initialValue: model || 'gpt-4o',
      });
      if (isCancel(modelResult)) process.exit(0);
      model = modelResult as string;

      const maxDiffInput = await text({
        message: 'Max diff characters',
        initialValue: String(maxDiffChars || '8000'),
      });
      if (isCancel(maxDiffInput)) process.exit(0);
      maxDiffChars = parseInt(maxDiffInput as string, 10);

      const langResult = await select({
        message: 'Output language',
        options: [
          { value: 'id', label: 'id — Indonesian' },
          { value: 'en', label: 'en — English' },
        ],
        initialValue: lang,
      });
      if (isCancel(langResult)) process.exit(0);
      lang = langResult as Language;
    }

    let sections: Section[] = existingConfig.templates || ['summary', 'changes', 'testing', 'review', 'notes', 'references'];
    let autoUpdate = existingConfig.autoUpdate ?? true;

    if (!configExists || reconfig) {
      const sectionResult = await multiselect({
        message: 'Pilih section template:',
        options: [
          { value: 'summary', label: 'Ringkasan', hint: 'Deskripsi singkat MR/PR' },
          { value: 'changes', label: 'Daftar Perubahan', hint: 'Fitur, perbaikan, removals' },
          { value: 'testing', label: 'Testing', hint: 'Checklist testing' },
          { value: 'review', label: 'AI Review', hint: 'Analisis kode oleh AI' },
          { value: 'notes', label: 'Catatan', hint: 'Catatan developer (manual)' },
          { value: 'references', label: 'Referensi', hint: 'Link issue/ticket (manual)' },
        ],
        required: true,
        initialValues: sections,
      });
      if (isCancel(sectionResult)) process.exit(0);
      sections = sectionResult as Section[];

      const autoUpdateResult = await confirm({
        message: 'Auto-update description when new commits pushed?',
        initialValue: autoUpdate,
      });
      if (isCancel(autoUpdateResult)) process.exit(0);
      autoUpdate = autoUpdateResult as boolean;
    }

    const config: Config = {
      platforms: configExists
        ? [...new Set([...existingConfig.platforms, platform])]
        : [platform],
      aiProvider: 'openai',
      model,
      lang,
      maxDiffChars,
      autoUpdate,
      templates: sections,
      providers: {
        openai: { apiKey: 'env:OPENAI_API_KEY', model },
      },
    };

    const mrDescribeDir = resolve(cwd, '.mr-describe', platform);
    mkdirSync(mrDescribeDir, { recursive: true });

    const type = platform === 'gitlab' ? 'mr' : 'pr';
    const template = buildTemplate(type, sections, lang);

    if (platform === 'gitlab') {
      const gitlabScriptPath = resolve(mrDescribeDir, 'generate-mr-desc.js');
      if (generateScript) {
        writeFileSync(gitlabScriptPath, generateGitLabScript(config, lang));
      } else if (existsSync(gitlabScriptPath)) {
        rmSync(gitlabScriptPath);
      }
      writeFileSync(resolve(cwd, '.gitlab-ci.yml'), generateGitLabCI(generateScript));
      // mkdirSync(resolve(cwd, '.gitlab', 'merge_request_templates'), { recursive: true });
      // writeFileSync(resolve(cwd, '.gitlab', 'merge_request_templates', 'Default.md'), template);
    } else if (platform === 'github') {
      const githubScriptPath = resolve(mrDescribeDir, 'generate-pr-desc.js');
      if (generateScript) {
        writeFileSync(githubScriptPath, generateGitHubScript(config, lang));
      } else if (existsSync(githubScriptPath)) {
        rmSync(githubScriptPath);
      }
      mkdirSync(resolve(cwd, '.github', 'workflows'), { recursive: true });
      writeFileSync(resolve(cwd, '.github', 'workflows', 'mr-describe.yml'), generateGitHubWorkflow(generateScript));
      // mkdirSync(resolve(cwd, '.github'), { recursive: true });
      // writeFileSync(resolve(cwd, '.github', 'PULL_REQUEST_TEMPLATE.md'), template);
    }

    saveConfig(config, cwd);

    outro(`Successfully initialized mr-describe for ${platform}!`);
    console.log('Next steps:');
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

    const type = platform === 'gitlab' ? 'mr' : 'pr';
    const template = buildTemplate(type, config.templates || ['summary', 'changes', 'testing', 'review', 'notes', 'references'], config.lang);

    if (platform === 'gitlab') {
      const token = process.env.GITLAB_TOKEN;
      const projectId = process.env.CI_PROJECT_ID;
      const mrIid = process.env.CI_MERGE_REQUEST_IID;
      const baseUrl = process.env.GITLAB_API_V4_URL || 'https://gitlab.com/api/v4';

      if (!token || !projectId || !mrIid) {
        console.error('❌ Missing required CI variables (GITLAB_TOKEN, CI_PROJECT_ID, CI_MERGE_REQUEST_IID)');
        process.exit(1);
      }

      const generator = new GitLabGenerator(token, projectId, mrIid, baseUrl, provider, template, config.lang, config.templates, config.autoUpdate);
      await generator.generate();
    } else if (platform === 'github') {
      const token = process.env.GITHUB_TOKEN;
      const owner = process.env.GITHUB_REPOSITORY_OWNER;
      const repoParts = process.env.GITHUB_REPOSITORY?.split('/');
      const repo = repoParts?.[1];
      const prNumber = process.env.GITHUB_PR_NUMBER;

      if (!token || !owner || !repo || !prNumber) {
        console.error('❌ Missing required CI variables (GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_PR_NUMBER)');
        process.exit(1);
      }

      const generator = new GitHubGenerator(token, owner, repo, prNumber, 'https://api.github.com', provider, template, config.lang, config.templates, config.autoUpdate);
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
    } else if (key === 'lang') {
      if (value !== 'id' && value !== 'en') {
        console.error('❌ Lang must be "id" or "en"');
        process.exit(1);
      }
      config.lang = value as Language;
    } else if (key === 'autoUpdate') {
      if (value !== 'true' && value !== 'false') {
        console.error('❌ autoUpdate must be "true" or "false"');
        process.exit(1);
      }
      config.autoUpdate = value === 'true';
    } else if (key === 'templates') {
      try {
        const parsed = JSON.parse(value) as string[];
        const validSections: Section[] = ['summary', 'changes', 'testing', 'review', 'notes', 'references'];
        config.templates = parsed.filter(s => validSections.includes(s as Section)) as Section[];
        if (config.templates.length === 0) {
          console.error('❌ At least one valid section required');
          process.exit(1);
        }
      } catch {
        console.error('❌ templates must be a JSON array, e.g. ["summary","changes","testing"]');
        process.exit(1);
      }
    } else {
      console.error(`❌ Unknown key: ${key}`);
      console.log('Available keys: platforms, model, maxDiffChars, aiProvider, lang, autoUpdate, templates');
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

function generateGitLabScript(config: Config, lang: Language): string {
  const systemMessage = buildSystemMessage('mr', lang);
  const generatedPrompt = buildPromptScriptTemplate('mr', lang);
  const sections = config.templates || ['summary', 'changes', 'testing', 'review', 'notes', 'references'];
  const type = 'mr';
  const template = buildTemplate(type, sections, lang);

  return `/**
 * generate-mr-desc.js
 * Auto-generate GitLab MR description using OpenAI
 */

const https = require('https');

const { GITLAB_TOKEN, CI_PROJECT_ID, CI_MERGE_REQUEST_IID, GITLAB_API_V4_URL, OPENAI_API_KEY } = process.env;

const MODEL = '${config.model}';
const MAX_DIFF_CHARS = ${config.maxDiffChars};
const SYSTEM_MESSAGE = ${JSON.stringify(systemMessage)};

const SECTIONS = ${JSON.stringify(sections)};
const AI_SECTIONS = ['summary', 'changes', 'testing', 'review'];
const HUMAN_SECTIONS = ['notes', 'references'];
const AUTO_UPDATE = ${config.autoUpdate};

const TEMPLATE = \`${template.replace(/`/g, '\\`')}\`;

function splitSections(description) {
  const sections = {};
  const re = /<!-- SECTION:(\\w+) -->\\n?([\\s\\S]*?)\\n?<!-- ENDSECTION:\\1 -->/g;
  let match;
  while ((match = re.exec(description)) !== null) {
    sections[match[1]] = match[2].trim();
  }
  return sections;
}

function preserveHumanSections(newDesc, existingDesc) {
  const newSections = splitSections(newDesc);
  const existingSections = splitSections(existingDesc);
  for (const section of SECTIONS) {
    if (HUMAN_SECTIONS.includes(section) && existingSections[section]) {
      newSections[section] = existingSections[section];
    }
  }
  return SECTIONS.map(s => {
    const content = newSections[s];
    return content
      ? \`<!-- SECTION:\${s} -->\\n\${content}\\n<!-- ENDSECTION:\${s} -->\`
      : \`<!-- SECTION:\${s} -->\\n-<!-- ENDSECTION:\${s} -->\`;
  }).join('\\n\\n');
}

function httpRequest(url, options, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { ...options.headers };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(url, { ...options, headers }, (res) => {
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
  const hasDesc = mrInfo.description?.trim().length > 0;

  if (hasDesc && !AUTO_UPDATE) { console.log('[MR Generator] Deskripsi sudah ada, autoUpdate=false, dilewati.'); return; }

  const diff = await getMRDiff();
  if (!diff.trim()) { console.log('[MR Generator] Tidak ada diff, dilewati.'); return; }
  const title = mrInfo.title;
  const template = TEMPLATE;
  const prompt = \`${generatedPrompt}\`;
  const desc = await callAI(prompt, diff);

  const finalDesc = hasDesc ? preserveHumanSections(desc, mrInfo.description) : desc;
  await updateMRDescription(finalDesc);
  console.log('[MR Generator] ✓ Deskripsi MR berhasil diupdate!');
}

main().catch(err => { console.error('[MR Generator] ✗', err.message); process.exit(0); });`;
}

function generateGitLabCI(generateScript: boolean): string {
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
    - ${generateScript ? 'cd .mr-describe/gitlab && node generate-mr-desc.js' : 'npx mr-describe generate --platform gitlab'}
  allow_failure: true
`;
}

function generateGitHubScript(config: Config, lang: Language): string {
  const systemMessage = buildSystemMessage('pr', lang);
  const generatedPrompt = buildPromptScriptTemplate('pr', lang);
  const sections = config.templates || ['summary', 'changes', 'testing', 'review', 'notes', 'references'];
  const type = 'pr';
  const template = buildTemplate(type, sections, lang);

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

const SECTIONS = ${JSON.stringify(sections)};
const AI_SECTIONS = ['summary', 'changes', 'testing', 'review'];
const HUMAN_SECTIONS = ['notes', 'references'];
const AUTO_UPDATE = ${config.autoUpdate};

const TEMPLATE = \`${template.replace(/`/g, '\\`')}\`;

function splitSections(description) {
  const sections = {};
  const re = /<!-- SECTION:(\\w+) -->\\n?([\\s\\S]*?)\\n?<!-- ENDSECTION:\\1 -->/g;
  let match;
  while ((match = re.exec(description)) !== null) {
    sections[match[1]] = match[2].trim();
  }
  return sections;
}

function preserveHumanSections(newDesc, existingDesc) {
  const newSections = splitSections(newDesc);
  const existingSections = splitSections(existingDesc);
  for (const section of SECTIONS) {
    if (HUMAN_SECTIONS.includes(section) && existingSections[section]) {
      newSections[section] = existingSections[section];
    }
  }
  return SECTIONS.map(s => {
    const content = newSections[s];
    return content
      ? \`<!-- SECTION:\${s} -->\\n\${content}\\n<!-- ENDSECTION:\${s} -->\`
      : \`<!-- SECTION:\${s} -->\\n-<!-- ENDSECTION:\${s} -->\`;
  }).join('\\n\\n');
}

function httpRequest(url, options, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { ...options.headers };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(url, { ...options, headers }, (res) => {
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
  const hasDesc = prInfo.body?.trim().length > 0;

  if (hasDesc && !AUTO_UPDATE) { console.log('[PR Generator] Deskripsi sudah ada, autoUpdate=false, dilewati.'); return; }

  const diff = await getPRDiff();
  if (!diff.trim()) { console.log('[PR Generator] Tidak ada diff, dilewati.'); return; }
  const title = prInfo.title;
  const template = TEMPLATE;
  const prompt = \`${generatedPrompt}\`;
  const desc = await callAI(prompt, diff);

  const finalDesc = hasDesc ? preserveHumanSections(desc, prInfo.body) : desc;
  await updatePRDescription(finalDesc);
  console.log('[PR Generator] ✓ Deskripsi PR berhasil diupdate!');
}

main().catch(err => { console.error('[PR Generator] ✗', err.message); process.exit(0); });`;
}

function generateGitHubWorkflow(generateScript: boolean): string {
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
          ${generateScript ? 'cd .mr-describe/github && node generate-pr-desc.js' : 'npx mr-describe generate --platform github'}
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
`;
}