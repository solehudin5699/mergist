import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { loadConfig, getConfigPath } from '../config.js';
import { buildTemplate } from '../templates/default.js';
import { OpenAIProvider } from '../providers/openai.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { PROVIDER_PRESETS } from '../types.js';
import type { Config } from '../types.js';
import { buildUserPrompt, buildSystemMessage } from '../prompts.js';
import type { PromptType } from '../prompts.js';
import { c, AI_SECTIONS, HUMAN_SECTIONS, ALL_SECTIONS } from '../constants.js';
import { startBreathing } from '../banner.js';
import { createMR, getProjectId, getProjectIdByPath, getGitLabApiUrl, getMRInfo, getMRDiff, updateMRDescription } from '../api/gitlab.js';
import { createPR, parseGitHubRemote, getPRInfo, getPRFiles, updatePRDescription } from '../api/github.js';
import { ParsedMrPr } from '../utils/url-parser.js';
import { validateArgs, parseUrl, formatGitLabDiff, formatGitHubDiff, buildSections, titleFromBranch } from '../utils/diff-helpers.js';

function loadEnvFile(path = '.env') {
  try {
    const content = readFileSync(resolve(process.cwd(), path), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && val && !process.env[key]) process.env[key] = val;
    }
  } catch {}
}

function colorizeOutput(output: string): string {
  const c = {
    bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
    cyan: (s: string) => `\x1b[36m${s}\x1b[39m`,
  };

  let clean = output.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n');
  if (!process.stdout.isTTY) return clean;

  clean = clean.replace(/^(## \S+.*)$/gm, m => c.cyan(c.bold(m)));

  return clean;
}

async function getPlatformToken(config: Config): Promise<string | null> {
  const envKey = config.platform === 'gitlab' ? 'GITLAB_TOKEN' : 'GITHUB_TOKEN';
  let token = process.env[envKey];
  if (!token) {
    console.log(`Set ${envKey} in .env to skip this prompt.`);
    const { password, isCancel } = await import('@clack/prompts');
    const result = await password({ message: `Enter ${envKey}:` });
    if (isCancel(result)) return null;
    token = result as string;
    process.env[envKey] = token;
  }
  return token;
}

async function getAiApiKey(config: Config): Promise<string | null> {
  const providerKey = config.aiProvider || 'openai';
  const providerCfg = config.providers[providerKey];
  const envKey = providerCfg?.apiKey?.replace(/^env:/, '') || 'AI_API_KEY';
  let key = process.env[envKey];
  if (!key) {
    console.log(`Set ${envKey} in .env to skip this prompt next time.`);
    const { password, isCancel } = await import('@clack/prompts');
    const result = await password({ message: `Enter ${envKey}:` });
    if (isCancel(result)) return null;
    key = result as string;
  }
  return key;
}

function initProvider(apiKey: string, config: Config): OpenAIProvider | AnthropicProvider {
  const providerKey = config.aiProvider || 'openai';
  const providerCfg = config.providers[providerKey];
  const model = providerCfg?.model || PROVIDER_PRESETS[providerKey]?.defaultModel || 'gpt-4o';
  const baseUrl = providerCfg?.baseUrl || PROVIDER_PRESETS[providerKey]?.baseUrl || 'https://api.openai.com/v1';

  return providerKey === 'anthropic'
    ? new AnthropicProvider(apiKey, model, config.maxTokens)
    : new OpenAIProvider(apiKey, model, baseUrl, config.maxTokens);
}

async function fetchUrlDiff(
  parsed: ParsedMrPr,
  token: string,
): Promise<{ diff: string; fromBranch: string; toBranch: string }> {
  try {
    if (parsed.platform === 'gitlab') {
      const projectId = await getProjectIdByPath(token, parsed.apiUrl, parsed.projectPath);
      const [mrInfo, mrDiff] = await Promise.all([
        getMRInfo(token, parsed.apiUrl, projectId, parsed.mrNumber),
        getMRDiff(token, parsed.apiUrl, projectId, parsed.mrNumber),
      ]);

      return {
        diff: formatGitLabDiff(mrDiff),
        fromBranch: mrInfo.source_branch,
        toBranch: mrInfo.target_branch,
      };
    } else {
      const [prInfo, prFiles] = await Promise.all([
        getPRInfo(token, parsed.owner, parsed.repo, parsed.prNumber),
        getPRFiles(token, parsed.owner, parsed.repo, parsed.prNumber),
      ]);

      return {
        diff: formatGitHubDiff(prFiles),
        fromBranch: prInfo.head.ref,
        toBranch: prInfo.base.ref,
      };
    }
  } catch (err: any) {
    const status = err.response?.status;
    const target = parsed.platform === 'gitlab' ? 'MR' : 'PR';

    if (status === 404) {
      throw new Error(`${target} not found. ${c.cyan('Check the URL and ensure you have access to the repository.')}`);
    }
    if (status === 401 || status === 403) {
      throw new Error(`Authentication failed (HTTP ${c.yellow(String(status))}). ${c.cyan('Verify your token is valid and has access to this repository.')}`);
    }
    throw new Error(`Failed to fetch ${target} details${status ? ` (HTTP ${c.yellow(String(status))})` : ''}.${err.message ? `\n  ${c.cyan('Detail:')} ${err.message}` : ''}`);
  }
}

function fetchLocalDiff(from: string, to: string): string {
  const errors: string[] = [];
  for (const [branch, label] of [[from, 'Source'], [to, 'Target']] as const) {
    try {
      execSync(`git rev-parse --verify ${branch}`, { encoding: 'utf-8', stdio: 'pipe' });
    } catch {
      errors.push(`${label} branch "${branch}" not found.`);
    }
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  try {
    return execSync(`git diff ${to}...${from}`, { encoding: 'utf-8' }).trim();
  } catch {
    try {
      return execSync(`git diff ${to}..${from}`, { encoding: 'utf-8' }).trim();
    } catch {
      throw new Error(`Failed to diff "${from}" vs "${to}".`);
    }
  }
}

async function generateWithSpinner(
  provider: OpenAIProvider | AnthropicProvider,
  prompt: string,
  diff: string,
  maxDiffChars: number,
  systemMessage: string,
): Promise<string> {
  const anim = startBreathing('Generating...');
  try {
    const description = await provider.generate(prompt, diff.slice(0, maxDiffChars || 8000), systemMessage);
    anim.stop('Done');
    console.log('');
    if (!description.trim()) {
      anim.stop('Failed');
      throw new Error('AI returned empty response. Try again or check your AI provider.');
    }
    return description;
  } catch (err: any) {
    anim.stop('Failed');
    if (err.message?.startsWith('AI returned empty')) throw err;
    const status = err.response?.status;
    const apiErr = err.response?.data?.error;
    let msg = `AI request failed${status ? ` (${c.yellow(String(status))})` : ''}`;
    if (apiErr?.message) msg += `\n  ${c.cyan('API:')} ${apiErr.message}`;
    throw new Error(msg);
  }
}

async function handleUrlUpdate(
  parsed: ParsedMrPr,
  url: string,
  finalDesc: string,
  config: Config,
): Promise<void> {
  const targetType = config.platform === 'gitlab' ? 'MR' : 'PR';
  const { confirm, isCancel, spinner } = await import('@clack/prompts');

  const shouldUpdate = await confirm({
    message: `Update description for this ${targetType}?`,
    initialValue: true,
  });
  if (!shouldUpdate || isCancel(shouldUpdate)) return;

  const token = await getPlatformToken(config);
  if (!token) return;

  const s = spinner();
  try {
    if (parsed.platform === 'gitlab') {
      const projectId = await getProjectIdByPath(token, parsed.apiUrl, parsed.projectPath);
      s.start('Updating MR description...');
      await updateMRDescription(token, parsed.apiUrl, projectId, parsed.mrNumber, finalDesc);
      s.stop(`✅ ${c.bold(c.green('MR description updated'))}: ${c.cyan(url)}`);
    } else {
      s.start('Updating PR description...');
      await updatePRDescription(token, parsed.owner, parsed.repo, parsed.prNumber, finalDesc);
      s.stop(`✅ ${c.bold(c.green('PR description updated'))}: ${c.cyan(url)}`);
    }
  } catch (err: any) {
    s.stop('❌ Failed');
    const status = err.response?.status;
    const respData = err.response?.data;
    console.error(`\n${c.red('Failed to update description')}${status ? ` (HTTP ${c.yellow(String(status))})` : ''}: ${c.cyan(err.message)}`);
    if (respData?.message) console.error(`  ${c.red('API:')} ${respData.message}`);
  }
}

async function handleCreateDraft(
  fromBranch: string,
  toBranch: string,
  finalDesc: string,
  config: Config,
): Promise<void> {
  const { confirm, isCancel, spinner } = await import('@clack/prompts');
  const type = config.platform === 'gitlab' ? 'mr' : 'pr';

  const shouldCreate = await confirm({
    message: `Create Draft ${type === 'mr' ? 'MR' : 'PR'} from ${fromBranch} to ${toBranch}?`,
    initialValue: false,
  });
  if (!shouldCreate || isCancel(shouldCreate)) return;

  const token = await getPlatformToken(config);
  if (!token) return;

  const s = spinner();
  try {
    const remoteUrl = getPlatformRemote(config.platform);
    const title = titleFromBranch(fromBranch);

    if (config.platform === 'gitlab') {
      const apiUrl = getGitLabApiUrl(remoteUrl);
      const projectId = await getProjectId(token, apiUrl, remoteUrl);
      console.log(`  Remote: ${remoteUrl}`);
      s.start('Creating draft MR...');
      const mr = await createMR(token, apiUrl, projectId, fromBranch, toBranch, title, finalDesc);
      s.stop(`✅ ${c.bold(c.green('Draft MR created'))}: ${c.cyan(mr.web_url)}`);
    } else {
      const { owner, repo } = parseGitHubRemote(remoteUrl);
      console.log(`  Remote: ${remoteUrl}`);
      s.start('Creating draft PR...');
      const pr = await createPR(token, owner, repo, fromBranch, toBranch, title, finalDesc);
      s.stop(`✅ ${c.bold(c.green('Draft PR created'))}: ${c.cyan(pr.html_url)}`);
    }
  } catch (err: any) {
    s.stop('❌ Failed');
    const status = err.response?.status;
    const respData = err.response?.data;
    if (status === 409) {
      const existing = err.response?.data?.message?.[0] || '';
      const match = existing.match(/!(\d+)/);
      const mrRef = match ? ` !${match[1]}` : '';
      console.error(`\n${c.red('Source branch')} "${fromBranch}" ${c.red('already has an open MR')}${mrRef}. ${c.cyan('Close it first or use a different branch.')}`);
      return;
    }
    const apiErr = respData?.error || respData?.message;
    const apiErrors = respData?.errors;
    console.error(`\n${c.red('Failed to create draft')}${status ? ` (HTTP ${c.yellow(String(status))})` : ''}: ${c.cyan(err.message)}`);
    if (apiErrors?.length) {
      const firstMsg = apiErrors[0]?.message || '';
      if (firstMsg.includes('not all refs are readable')) {
        console.error(`  ${c.red('•')} ${firstMsg}`);
        console.error(`  ${c.yellow('Tip:')} Your token may be missing ${c.cyan('Contents: Read')} permission.`);
        console.error(`  ${c.yellow('  ')} Go to ${c.cyan('https://github.com/settings/personal-access-tokens')}, select your token,`);
        console.error(`  ${c.yellow('  ')} set ${c.cyan('Repository permissions → Contents → Read')} and retry.`);
      } else {
        for (const e of apiErrors) {
          console.error(`  ${c.red('•')} ${e.field ? `${c.cyan(e.field)}: ` : ''}${e.message || e.code}`);
        }
      }
    } else if (apiErr) {
      console.error(`  ${c.red('API:')} ${typeof apiErr === 'string' ? apiErr : apiErr.message || JSON.stringify(apiErr)}`);
    } else if (respData) {
      console.error(`  ${c.red('Response:')} ${JSON.stringify(respData)}`);
    }
  }
}

export async function diffAction(opts: { from?: string; to?: string; url?: string }): Promise<void> {
  if (!existsSync(getConfigPath())) {
    console.error('No configuration found. Run `mergist init` first.');
    process.exit(1);
  }

  const config = loadConfig();
  loadEnvFile();

  try {
    validateArgs(opts);
  } catch (err: any) {
    console.error(`${c.red('Error:')} ${err.message}`);
    process.exit(1);
  }

  let diff: string;
  let fromBranch: string;
  let toBranch: string;
  let parsed: ParsedMrPr | undefined;

  if (opts.url) {
    parsed = parseUrl(opts.url, config);

    const token = await getPlatformToken(config);
    if (!token) process.exit(0);

    try {
      ({ diff, fromBranch, toBranch } = await fetchUrlDiff(parsed, token));
    } catch (err: any) {
      console.error(`\n${c.red('Error:')} ${err.message}`);
      process.exit(1);
    }
  } else {
    fromBranch = opts.from!;
    toBranch = opts.to!;

    try {
      diff = fetchLocalDiff(fromBranch, toBranch);
    } catch (err: any) {
      console.error(`${c.red('Error:')} ${err.message}`);
      process.exit(1);
    }
  }

  if (!diff) {
    const msg = opts.url
      ? 'No changes found in this MR/PR. Cannot generate description.'
      : `No diff between "${fromBranch}" and "${toBranch}".`;
    console.log(msg);
    process.exit(0);
  }

  const apiKey = await getAiApiKey(config);
  if (!apiKey) process.exit(0);

  const provider = initProvider(apiKey, config);
  const type: PromptType = config.platform === 'gitlab' ? 'mr' : 'pr';
  const sections = config.templates || ALL_SECTIONS;
  const template = buildTemplate(type, sections, config.lang);
  const aiSections = sections.filter(s => AI_SECTIONS.includes(s));
  const humanSections = sections.filter(s => HUMAN_SECTIONS.includes(s));
  const prompt = buildUserPrompt(type, fromBranch, template, config.lang, aiSections, humanSections);
  const systemMessage = buildSystemMessage(type, config.lang);

  let description: string;
  try {
    description = await generateWithSpinner(provider, prompt, diff, config.maxDiffChars, systemMessage);
  } catch (err: any) {
    console.error(`${c.red(err.message)}`);
    process.exit(0);
  }

  const finalDesc = buildSections(description, sections, type, config.lang);
  console.log(colorizeOutput(finalDesc));

  if (opts.url) {
    await handleUrlUpdate(parsed!, opts.url, finalDesc, config);
  } else {
    await handleCreateDraft(fromBranch, toBranch, finalDesc, config);
  }
}

function getPlatformRemote(platform: 'gitlab' | 'github'): string {
  const remotes = execSync('git remote', { encoding: 'utf-8', stdio: 'pipe' }).trim().split('\n').filter(Boolean);
  const matched: string[] = [];
  for (const name of remotes) {
    const url = execSync(`git remote get-url ${name}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
    if (platform === 'github' && url.includes('github.com')) matched.push(name);
    if (platform === 'gitlab' && (url.includes('gitlab.com') || url.includes('gitlab.'))) matched.push(name);
  }
  if (matched.length === 0) throw new Error(`No ${platform} remote found. Add a ${platform === 'github' ? 'GitHub' : 'GitLab'} remote first.`);
  const name = matched.includes('origin') ? 'origin' : matched[0];
  return execSync(`git remote get-url ${name}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
}
