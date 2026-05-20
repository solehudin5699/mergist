import { existsSync } from 'fs';
import { loadConfig, getConfigPath } from '../config.js';
import { buildTemplate } from '../templates/default.js';
import { GitLabGenerator } from '../generators/gitlab.js';
import { GitHubGenerator } from '../generators/github.js';
import { OpenAIProvider } from '../providers/openai.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { PROVIDER_PRESETS } from '../types.js';

export async function generateAction(opts: { platform?: string }): Promise<void> {
  if (!existsSync(getConfigPath())) {
    console.error('❌ No configuration found. Run `mergist init` first.');
    process.exit(1);
  }

  const config = loadConfig();
  const platform = opts.platform || config.platform;

  const providerKey = config.aiProvider || 'openai';
  const providerCfg = config.providers[providerKey] || { apiKey: 'env:AI_API_KEY', model: 'gpt-4o', baseUrl: '' };
  const model = providerCfg.model || PROVIDER_PRESETS[providerKey]?.defaultModel || 'gpt-4o';
  const baseUrl = providerCfg.baseUrl || PROVIDER_PRESETS[providerKey]?.baseUrl || 'https://api.openai.com/v1';
  const envKey = providerCfg.apiKey?.replace(/^env:/, '') || 'AI_API_KEY';
  const apiKey = process.env[envKey];
  if (!apiKey) {
    console.error(`❌ API key not found. Set ${envKey} env variable.`);
    process.exit(1);
  }

  const provider = providerKey === 'anthropic'
    ? new AnthropicProvider(apiKey, model, config.maxTokens)
    : new OpenAIProvider(apiKey, model, baseUrl, config.maxTokens);

  const type = platform === 'gitlab' ? 'mr' : 'pr';
  const template = buildTemplate(type, config.templates || ['summary', 'changes', 'review', 'testing', 'notes', 'references'], config.lang);

  if (platform === 'gitlab') {
    const token = process.env.GITLAB_TOKEN;
    const projectId = process.env.CI_PROJECT_ID;
    const mrIid = process.env.CI_MERGE_REQUEST_IID;
    const baseUrl = process.env.CI_API_V4_URL || 'https://gitlab.com/api/v4';

    if (!token || !projectId || !mrIid) {
      console.error('❌ Missing required CI variables (GITLAB_TOKEN, CI_PROJECT_ID, CI_MERGE_REQUEST_IID)');
      process.exit(1);
    }

    const generator = new GitLabGenerator(token, projectId, mrIid, baseUrl, provider, template, config.lang, config.templates, config.autoUpdate);
    try {
      await generator.generate();
    } catch (err: any) {
      const status = err.response?.status;
      const apiErr = err.response?.data?.error;
      console.error(`[MR Generator] ✗ AI request failed${status ? ` (${status})` : ''}`);
      if (apiErr?.message) console.error(`  API: ${apiErr.message}`);
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
      const status = err.response?.status;
      const apiErr = err.response?.data?.error;
      console.error(`[MR Generator] ✗ AI request failed${status ? ` (${status})` : ''}`);
      if (apiErr?.message) console.error(`  API: ${apiErr.message}`);
      process.exit(0);
    }
  }
}
