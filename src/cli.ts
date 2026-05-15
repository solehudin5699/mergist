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
import type { Platform, Language, Config, Section, AIProvider } from './types.js';
import { PROVIDER_PRESETS } from './types.js';

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
    let aiProvider: AIProvider = existingConfig.aiProvider || 'openai';
    let apiBaseUrl = existingConfig.providers?.[aiProvider]?.baseUrl || '';

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
      const providerResult = await select({
        message: 'AI Provider',
        options: [
          { value: 'openai', label: 'OpenAI' },
          { value: 'deepseek', label: 'DeepSeek' },
          { value: 'groq', label: 'Groq' },
          { value: 'custom', label: 'Custom (OpenAI-compatible)' },
        ],
        initialValue: aiProvider,
      });
      if (isCancel(providerResult)) process.exit(0);
      aiProvider = providerResult as AIProvider;

      const preset = PROVIDER_PRESETS[aiProvider];
      model = preset.defaultModel;
      apiBaseUrl = existingConfig.providers?.[aiProvider]?.baseUrl || preset.baseUrl;

      const modelResult = await text({
        message: 'AI model',
        initialValue: model,
      });
      if (isCancel(modelResult)) process.exit(0);
      model = (modelResult as string).trim();

      if (aiProvider === 'custom') {
        const baseUrlResult = await text({
          message: 'API base URL',
          initialValue: apiBaseUrl,
        });
        if (isCancel(baseUrlResult)) process.exit(0);
        apiBaseUrl = (baseUrlResult as string).trim() || 'https://api.openai.com/v1';
      }

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
      aiProvider,
      model,
      lang,
      maxDiffChars,
      autoUpdate,
      templates: sections,
      providers: {
        [aiProvider]: { apiKey: 'env:AI_API_KEY', model, baseUrl: apiBaseUrl },
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
      writeFileSync(resolve(cwd, '.github', 'workflows', 'mr-describe.yml'), generateGitHubWorkflow(generateScript, config));
      // mkdirSync(resolve(cwd, '.github'), { recursive: true });
      // writeFileSync(resolve(cwd, '.github', 'PULL_REQUEST_TEMPLATE.md'), template);
    }

    saveConfig(config, cwd);

    outro(`Successfully initialized mr-describe for ${platform}!`);
    console.log('Next steps:');
    console.log('1. Set your API key in CI secrets (AI_API_KEY)');
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

    const providerKey = config.aiProvider || 'openai';
    const providerCfg = config.providers[providerKey] || { apiKey: 'env:AI_API_KEY', model: 'gpt-4o', baseUrl: '' };
    const model = providerCfg.model || config.model || 'gpt-4o';
    const baseUrl = providerCfg.baseUrl || PROVIDER_PRESETS[providerKey]?.baseUrl || 'https://api.openai.com/v1';
    const envKey = providerCfg.apiKey?.replace(/^env:/, '') || 'AI_API_KEY';
    const apiKey = process.env[envKey];
    if (!apiKey) {
      console.error(`❌ API key not found. Set ${envKey} env variable.`);
      process.exit(1);
    }

    const provider = new OpenAIProvider(apiKey, model, baseUrl);

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
      try {
        await generator.generate();
      } catch (err: any) {
        console.error(`[MR Generator] ✗ ${err.message}`);
        process.exit(0);
      }
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
      try {
        await generator.generate();
      } catch (err: any) {
        console.error(`[MR Generator] ✗ ${err.message}`);
        process.exit(0);
      }
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
      const validProviders = ['openai', 'deepseek', 'groq', 'custom'];
      if (!validProviders.includes(value)) {
        console.error(`❌ aiProvider must be one of: ${validProviders.join(', ')}`);
        process.exit(1);
      }
      config.aiProvider = value as AIProvider;
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

function generateGitLabScript(config: Config, lang: Language): string {
  const systemMessage = buildSystemMessage('mr', lang);
  const generatedPrompt = buildPromptScriptTemplate('mr', lang);
  const sections = config.templates || ['summary', 'changes', 'testing', 'review', 'notes', 'references'];
  const type = 'mr';
  const template = buildTemplate(type, sections, lang);
  const providerKey = config.aiProvider || 'openai';
  const providerCfg = config.providers[providerKey] || { apiKey: 'env:AI_API_KEY', baseUrl: '', model: '' };
  const envVarName = providerCfg.apiKey?.replace(/^env:/, '') || 'AI_API_KEY';
  const model = providerCfg.model || config.model || 'gpt-4o';
  const baseUrl = providerCfg.baseUrl || PROVIDER_PRESETS[providerKey]?.baseUrl || 'https://api.openai.com/v1';

  return `/**
 * generate-mr-desc.js
 * Auto-generate GitLab MR description using ${providerKey}
 */

const https = require('https');

const { GITLAB_TOKEN, CI_PROJECT_ID, CI_MERGE_REQUEST_IID, GITLAB_API_V4_URL, ${envVarName}: AI_API_KEY } = process.env;

const MODEL = '${model}';
const MAX_DIFF_CHARS = ${config.maxDiffChars};
const SYSTEM_MESSAGE = ${JSON.stringify(systemMessage)};

const SECTIONS = ${JSON.stringify(sections)};
const AI_SECTIONS = ['summary', 'changes', 'testing', 'review'];
const HUMAN_SECTIONS = ['notes', 'references'];
const AUTO_UPDATE = ${config.autoUpdate};

const BASE_URL = '${baseUrl}';

const TEMPLATE = \`${template.replace(/`/g, '\\`')}\`;

const SECTION_HEADINGS = {
  summary: ['## Ringkasan', '## Summary'],
  changes: ['## Daftar Perubahan', '## Changes'],
  testing: ['## Testing'],
  review: ['## AI Review'],
  notes: ['## Catatan', '## Notes'],
  references: ['## Referensi', '## References'],
};

function wrapInMarkers(text, sections) {
  if (text.includes('<!-- SECTION:')) return text;
  const parts = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const headings = SECTION_HEADINGS[s] || [\`## \${s}\`];
    const heading = headings.find(h => text.includes(h));
    if (!heading) {
      parts.push(\`<!-- SECTION:\${s} -->\\n-\\n<!-- ENDSECTION:\${s} -->\`);
      continue;
    }
    const headingIdx = text.indexOf(heading);
    const afterHeading = text.slice(headingIdx + heading.length);
    const nextSections = sections.slice(i + 1);
    const nextHeading = nextSections.map(s2 => SECTION_HEADINGS[s2]).flat().find(h => afterHeading.includes(h));
    const content = nextHeading
      ? afterHeading.slice(0, afterHeading.indexOf(nextHeading)).trim()
      : afterHeading.trim();
    parts.push(\`<!-- SECTION:\${s} -->\\n\${heading}\\n\${content || '-'}\\n<!-- ENDSECTION:\${s} -->\`);
  }
  return parts.join('\\n\\n');
}

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i < retries - 1 && err.status === 429) {
        const delay = Math.pow(2, i) * 1000;
        console.log(\`[MR Generator] Rate limited, retrying in \${delay}ms...\`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

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
  const res = await httpRequest(BASE_URL + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${AI_API_KEY}\` }
  }, { model: MODEL, max_tokens: 1000, messages: [{ role: 'system', content: SYSTEM_MESSAGE }, { role: 'user', content: prompt + '\\n\\nGIT DIFF:\\n' + diff.slice(0, MAX_DIFF_CHARS) }] });
  if (res.status !== 200) {
    const err = new Error(\`AI error (HTTP \${res.status})\`);
    err.status = res.status;
    throw err;
  }
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
  const desc = await withRetry(() => callAI(prompt, diff));
  const wrappedDesc = desc.includes('<!-- SECTION:') ? desc : wrapInMarkers(desc, SECTIONS);

  const finalDesc = hasDesc ? preserveHumanSections(wrappedDesc, mrInfo.description) : wrappedDesc;
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
  const providerKey = config.aiProvider || 'openai';
  const providerCfg = config.providers[providerKey] || { apiKey: 'env:AI_API_KEY', baseUrl: '', model: '' };
  const envVarName = providerCfg.apiKey?.replace(/^env:/, '') || 'AI_API_KEY';
  const model = providerCfg.model || config.model || 'gpt-4o';
  const baseUrl = providerCfg.baseUrl || PROVIDER_PRESETS[providerKey]?.baseUrl || 'https://api.openai.com/v1';

  return `/**
 * generate-pr-desc.js
 * Auto-generate GitHub PR description using ${providerKey}
 */

const https = require('https');

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_PR_NUMBER, ${envVarName}: AI_API_KEY } = process.env;
const [OWNER, REPO] = GITHUB_REPOSITORY.split('/');

const MODEL = '${model}';
const MAX_DIFF_CHARS = ${config.maxDiffChars};
const SYSTEM_MESSAGE = ${JSON.stringify(systemMessage)};

const SECTIONS = ${JSON.stringify(sections)};
const AI_SECTIONS = ['summary', 'changes', 'testing', 'review'];
const HUMAN_SECTIONS = ['notes', 'references'];
const AUTO_UPDATE = ${config.autoUpdate};

const BASE_URL = '${baseUrl}';

const TEMPLATE = \`${template.replace(/`/g, '\\`')}\`;

const SECTION_HEADINGS = {
  summary: ['## Ringkasan', '## Summary'],
  changes: ['## Daftar Perubahan', '## Changes'],
  testing: ['## Testing'],
  review: ['## AI Review'],
  notes: ['## Catatan', '## Notes'],
  references: ['## Referensi', '## References'],
};

function wrapInMarkers(text, sections) {
  if (text.includes('<!-- SECTION:')) return text;
  const parts = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const headings = SECTION_HEADINGS[s] || [\`## \${s}\`];
    const heading = headings.find(h => text.includes(h));
    if (!heading) {
      parts.push(\`<!-- SECTION:\${s} -->\\n-\\n<!-- ENDSECTION:\${s} -->\`);
      continue;
    }
    const headingIdx = text.indexOf(heading);
    const afterHeading = text.slice(headingIdx + heading.length);
    const nextSections = sections.slice(i + 1);
    const nextHeading = nextSections.map(s2 => SECTION_HEADINGS[s2]).flat().find(h => afterHeading.includes(h));
    const content = nextHeading
      ? afterHeading.slice(0, afterHeading.indexOf(nextHeading)).trim()
      : afterHeading.trim();
    parts.push(\`<!-- SECTION:\${s} -->\\n\${heading}\\n\${content || '-'}\\n<!-- ENDSECTION:\${s} -->\`);
  }
  return parts.join('\\n\\n');
}

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i < retries - 1 && err.status === 429) {
        const delay = Math.pow(2, i) * 1000;
        console.log(\`[PR Generator] Rate limited, retrying in \${delay}ms...\`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

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
    headers: { 'Authorization': \`Bearer \${GITHUB_TOKEN}\`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': '${pkg.name}/${pkg.version}' }
  });
  if (res.status !== 200) throw new Error(\`Failed to get PR info (HTTP \${res.status})\`);
  return res.body;
}

async function getPRDiff() {
  const res = await httpRequest(\`https://api.github.com/repos/\${OWNER}/\${REPO}/pulls/\${GITHUB_PR_NUMBER}/files\`, {
    method: 'GET',
    headers: { 'Authorization': \`Bearer \${GITHUB_TOKEN}\`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': '${pkg.name}/${pkg.version}' }
  });
  if (res.status !== 200) throw new Error(\`Failed to get PR diff (HTTP \${res.status})\`);
  return res.body.map(f => f.patch ? \`--- \${f.filename}\\n+++ \${f.filename}\\n\${f.patch}\` : '').filter(Boolean).join('\\n\\n');
}

async function updatePRDescription(desc) {
  await httpRequest(\`https://api.github.com/repos/\${OWNER}/\${REPO}/pulls/\${GITHUB_PR_NUMBER}\`, {
    method: 'PATCH',
    headers: { 'Authorization': \`Bearer \${GITHUB_TOKEN}\`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': '${pkg.name}/${pkg.version}' }
  }, { body: desc });
}

async function callAI(prompt, diff) {
  const res = await httpRequest(BASE_URL + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${AI_API_KEY}\` }
  }, { model: MODEL, max_tokens: 1000, messages: [{ role: 'system', content: SYSTEM_MESSAGE }, { role: 'user', content: prompt + '\\n\\nGIT DIFF:\\n' + diff.slice(0, MAX_DIFF_CHARS) }] });
  if (res.status !== 200) {
    const err = new Error(\`AI error (HTTP \${res.status})\`);
    err.status = res.status;
    throw err;
  }
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
  const desc = await withRetry(() => callAI(prompt, diff));
  const wrappedDesc = desc.includes('<!-- SECTION:') ? desc : wrapInMarkers(desc, SECTIONS);

  const finalDesc = hasDesc ? preserveHumanSections(wrappedDesc, prInfo.body) : wrappedDesc;
  await updatePRDescription(finalDesc);
  console.log('[PR Generator] ✓ Deskripsi PR berhasil diupdate!');
}

main().catch(err => { console.error('[PR Generator] ✗', err.message); process.exit(0); });`;
}

function generateGitHubWorkflow(generateScript: boolean, config: Config): string {
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
          ${generateScript ? 'cd .mr-describe/github && node generate-pr-desc.js' : 'npx mr-describe generate --platform github'}
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_PR_NUMBER: \${{ github.event.number }}
          ${envVarName}: \${{ secrets.${envVarName} }}
`;
}