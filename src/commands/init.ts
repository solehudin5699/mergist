import { intro, outro, select, confirm, text, multiselect, isCancel } from '@clack/prompts';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { loadConfig, saveConfig, getConfigPath } from '../config.js';
import { buildTemplate } from '../templates/default.js';
import { generateGitLabScript } from '../templates/gitlab-script.js';
import { generateGitHubScript } from '../templates/github-script.js';
import { generateGitLabCI, generateGitHubWorkflow } from '../templates/ci-templates.js';
import type { Platform, Language, Config, Section, AIProvider } from '../types.js';
import { PROVIDER_PRESETS } from '../types.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));

export async function initAction(): Promise<void> {
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
  } else if (platform === 'github') {
    const githubScriptPath = resolve(mrDescribeDir, 'generate-pr-desc.js');
    if (generateScript) {
      writeFileSync(githubScriptPath, generateGitHubScript(config, lang));
    } else if (existsSync(githubScriptPath)) {
      rmSync(githubScriptPath);
    }
    mkdirSync(resolve(cwd, '.github', 'workflows'), { recursive: true });
    writeFileSync(resolve(cwd, '.github', 'workflows', 'mr-describe.yml'), generateGitHubWorkflow(generateScript, config));
  }

  saveConfig(config, cwd);

  outro(`Successfully initialized mr-describe for ${platform}!`);
  console.log('Next steps:');
  console.log('1. Set your API key in CI secrets (AI_API_KEY)');
  console.log('2. Commit the generated files');
  console.log('3. Create a merge request to test');
}
