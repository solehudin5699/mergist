import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { loadConfig, getConfigPath } from '../config.js';
import { buildTemplate, splitSections, wrapInMarkers } from '../templates/default.js';
import { OpenAIProvider } from '../providers/openai.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { PROVIDER_PRESETS } from '../types.js';
import { buildUserPrompt, buildSystemMessage } from '../prompts.js';
import { c, AI_SECTIONS, HUMAN_SECTIONS, ALL_SECTIONS } from '../constants.js';
import { startBreathing } from '../banner.js';
import { createMR, getProjectId, getGitLabApiUrl } from '../api/gitlab.js';
import { createPR, parseGitHubRemote } from '../api/github.js';

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

export async function diffAction(opts: { from?: string; to?: string }): Promise<void> {
  if (!existsSync(getConfigPath())) {
    console.error('No configuration found. Run `mergist init` first.');
    process.exit(1);
  }

  const config = loadConfig();

  const fromBranch = opts.from!;
  const toBranch = opts.to!;

  const errors: string[] = [];
  try {
    execSync(`git rev-parse --verify ${fromBranch}`, { encoding: 'utf-8', stdio: 'pipe' });
  } catch {
    errors.push(`Source branch "${fromBranch}" not found.`);
  }
  try {
    execSync(`git rev-parse --verify ${toBranch}`, { encoding: 'utf-8', stdio: 'pipe' });
  } catch {
    errors.push(`Target branch "${toBranch}" not found.`);
  }
  if (errors.length) {
    for (const err of errors) console.error(err);
    process.exit(1);
  }

  let diff: string;
  try {
    diff = execSync(`git diff ${toBranch}...${fromBranch}`, { encoding: 'utf-8' }).trim();
  } catch {
    try {
      diff = execSync(`git diff ${toBranch}..${fromBranch}`, { encoding: 'utf-8' }).trim();
    } catch {
      console.error(`Failed to diff "${fromBranch}" vs "${toBranch}".`);
      process.exit(1);
    }
  }

  if (!diff) {
    console.log(`No diff between "${fromBranch}" and "${toBranch}".`);
    process.exit(0);
  }

  const providerKey = config.aiProvider || 'openai';
  const providerCfg = config.providers[providerKey];
  const envKey = providerCfg?.apiKey?.replace(/^env:/, '') || 'AI_API_KEY';

  loadEnvFile();

  let apiKey = process.env[envKey];
  if (!apiKey) {
    console.log('Set AI_API_KEY in .env to skip this prompt next time.');
    const { password, isCancel } = await import('@clack/prompts');
    const result = await password({ message: `Enter ${envKey}:` });
    if (isCancel(result)) process.exit(0);
    apiKey = result as string;
  }

  const model = providerCfg?.model || PROVIDER_PRESETS[providerKey]?.defaultModel || 'gpt-4o';
  const baseUrl = providerCfg?.baseUrl || PROVIDER_PRESETS[providerKey]?.baseUrl || 'https://api.openai.com/v1';
  const provider = providerKey === 'anthropic'
    ? new AnthropicProvider(apiKey, model, config.maxTokens)
    : new OpenAIProvider(apiKey, model, baseUrl, config.maxTokens);

  const sections = config.templates || ALL_SECTIONS;
  const type = config.platform === 'gitlab' ? 'mr' : 'pr';
  const template = buildTemplate(type, sections, config.lang);
  const aiSections = sections.filter(s => AI_SECTIONS.includes(s));
  const humanSections = sections.filter(s => HUMAN_SECTIONS.includes(s));
  const prompt = buildUserPrompt(type, fromBranch, template, config.lang, aiSections, humanSections);
  const systemMessage = buildSystemMessage(type, config.lang);

  let description: string;
  const anim = startBreathing('Generating...');
  try {
    description = await provider.generate(prompt, diff.slice(0, config.maxDiffChars || 8000), systemMessage);
    anim.stop('Done');
    console.log('');
  } catch (err: any) {
    anim.stop('Failed');
    const status = err.response?.status;
    const apiErr = err.response?.data?.error;
    console.error(`${c.red('AI request failed')}${status ? ` (${status})` : ''}`);
    if (apiErr?.message) console.error(`  ${c.cyan('API:')} ${apiErr.message}`);
    process.exit(0);
  }
  if (!description.trim()) {
    anim.stop('Failed');
    console.error(`${c.red('AI returned empty response.')} ${c.cyan('Try again or check your AI provider.')}`);
    process.exit(0);
  }
  const wrapped = wrapInMarkers(description, sections);

  const parsedSections = splitSections(wrapped);
  const humanTmpl = buildTemplate(type, HUMAN_SECTIONS, config.lang);
  const humanTmplSections = splitSections(humanTmpl);
  for (const s of HUMAN_SECTIONS) {
    if (!parsedSections[s] || parsedSections[s] === '-') {
      parsedSections[s] = humanTmplSections[s];
    }
  }

  const finalDesc = sections.map(s =>
    `<!-- SECTION:${s} -->\n${parsedSections[s]}\n<!-- ENDSECTION:${s} -->`
  ).join('\n\n');

  console.log(colorizeOutput(finalDesc));

  const { confirm, password, isCancel, spinner } = await import('@clack/prompts');
  const createDraft = await confirm({
    message: `Create Draft ${type === 'mr' ? 'MR' : 'PR'} from ${fromBranch} to ${toBranch}?`,
    initialValue: false,
  });
  if (!createDraft || isCancel(createDraft)) return;

  const tokenEnvKey = config.platform === 'gitlab' ? 'GITLAB_TOKEN' : 'GITHUB_TOKEN';
  let platformToken = process.env[tokenEnvKey];
  if (!platformToken) {
    console.log(`Set ${tokenEnvKey} in .env to skip this prompt.`);
    const result = await password({ message: `Enter ${tokenEnvKey}:` });
    if (isCancel(result)) return;
    platformToken = result as string;
  }

  const s = spinner();
  try {
    const remoteUrl = getPlatformRemote(config.platform);
    const title = titleFromBranch(fromBranch);

    if (config.platform === 'gitlab') {
      const apiUrl = getGitLabApiUrl(remoteUrl);
      const projectId = await getProjectId(platformToken, apiUrl, remoteUrl);
      console.log(`  Remote: ${remoteUrl}`);
      s.start('Creating draft MR...');
      const mr = await createMR(platformToken, apiUrl, projectId, fromBranch, toBranch, title, finalDesc);
      s.stop(`✅ ${c.bold(c.green('Draft MR created'))}: ${c.cyan(mr.web_url)}`);
    } else {
      const { owner, repo } = parseGitHubRemote(remoteUrl);
      console.log(`  Remote: ${remoteUrl}`);
      s.start('Creating draft PR...');
      const pr = await createPR(platformToken, owner, repo, fromBranch, toBranch, title, finalDesc);
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
      // GitHub-specific: API returns errors array with field-level validation details
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

function titleFromBranch(branch: string): string {
  const parts = branch.split('/');
  const name = parts.length < 2 ? branch : parts.slice(1).join('/');
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
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
