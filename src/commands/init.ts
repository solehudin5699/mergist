import { intro, outro, select, confirm, text, multiselect, isCancel } from '@clack/prompts';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { loadConfig, saveConfig, getConfigPath } from '../config.js';
import { generateGitLabScript } from '../templates/gitlab-script.js';
import { generateGitHubScript } from '../templates/github-script.js';
import { generateGitLabCI, generateGitHubWorkflow } from '../templates/ci-templates.js';
import type { Platform, Language, Config, Section, AIProvider } from '../types.js';
import { PROVIDER_PRESETS } from '../types.js';
import { printNextSteps } from '../steps.js';
import { PKG_NAME, PKG_DESCRIPTION, PKG_VERSION, ALL_SECTIONS } from '../constants.js';
import { printBanner } from '../banner.js';

function ensureMergistStage(content: string): string {
  if (!/^stages:$/m.test(content)) return content;
  if (/^  - mergist$/m.test(content)) return content;
  return content.replace(/^(stages:\n(?:  - .+\n?)*)/m, (m) => m.trimEnd() + '\n  - mergist\n');
}

function mergeGitLabCI(oldContent: string, newTemplate: string): string {
  if (/^stages:$/m.test(oldContent)) {
    newTemplate = newTemplate.replace(/^stages:\n  - mergist\n\n/, '');
  }

  const lines = oldContent.split('\n');
  let jobStart = -1;
  let jobEnd = lines.length;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 'mergist:') {
      jobStart = i;
    } else if (jobStart !== -1 && /^[a-zA-Z_]/.test(lines[i])) {
      jobEnd = i;
      break;
    }
  }

  if (jobStart === -1) {
    return ensureMergistStage(oldContent.trimEnd()) + '\n' + newTemplate;
  }

  const before = ensureMergistStage(lines.slice(0, jobStart).join('\n').trimEnd());
  const after = lines.slice(jobEnd).join('\n');
  return before + '\n' + newTemplate.trimEnd() + '\n' + after;
}

export async function initAction(): Promise<void> {
  const cwd = process.cwd();

  printBanner();
  intro(`${PKG_NAME} v${PKG_VERSION}\n${PKG_DESCRIPTION}`);

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

  let reinit = false;
  if (configExists && existingConfig.platform === platform) {
    const reinitResult = await confirm({
      message: `Platform "${platform}" is already configured. Reinitialize?`,
      initialValue: false,
    });
    if (isCancel(reinitResult)) { outro('Cancelled.'); process.exit(0); }
    if (!reinitResult) { outro('Cancelled.'); process.exit(0); }
    reinit = true;
  }

  const useCIResult = await confirm({
    message: 'Configure CI pipeline?',
    initialValue: true,
  });
  if (isCancel(useCIResult)) process.exit(0);
  const useCI = useCIResult as boolean;

  let generateScript = false;
  let ciTargetBranches: string[] | undefined;
  if (useCI) {
    const scriptResult = await confirm({
      message: 'Generate standalone script (no npx dependency)?',
      initialValue: false,
    });
    if (isCancel(scriptResult)) process.exit(0);
    generateScript = scriptResult as boolean;

    const branchLimitResult = await confirm({
      message: 'Limit CI to specific target branches?',
      initialValue: false,
    });
    if (isCancel(branchLimitResult)) process.exit(0);

    if (branchLimitResult) {
      const branchesResult = await text({
        message: 'Target branches (comma separated, e.g. main,develop)',
        placeholder: 'main',
      });
      if (isCancel(branchesResult)) process.exit(0);
      ciTargetBranches = (branchesResult as string)
        .split(',')
        .map(b => b.trim())
        .filter(Boolean);
    }
  }

  let model = existingConfig.providers?.[existingConfig.aiProvider]?.model || '';
  let maxDiffChars = existingConfig.maxDiffChars;
  let maxTokens = existingConfig.maxTokens;
  let lang: Language = existingConfig.lang;
  let aiProvider: AIProvider = existingConfig.aiProvider || 'openai';
  let apiBaseUrl = existingConfig.providers?.[aiProvider]?.baseUrl || '';

  const shouldPrompt = !configExists || existingConfig.platform !== platform || reinit;

  if (shouldPrompt) {
    const providerResult = await select({
      message: 'AI Provider',
      options: [
        { value: 'openai', label: 'OpenAI' },
        { value: 'deepseek', label: 'DeepSeek' },
        { value: 'groq', label: 'Groq' },
        { value: 'anthropic', label: 'Anthropic' },
        { value: 'custom', label: 'Custom (OpenAI-compatible)' },
      ],
      initialValue: aiProvider,
    });
    if (isCancel(providerResult)) process.exit(0);
    aiProvider = providerResult as AIProvider;

    const preset = PROVIDER_PRESETS[aiProvider];
    model = preset.defaultModel;
    apiBaseUrl = existingConfig.providers?.[aiProvider]?.baseUrl || preset.baseUrl;

    if (aiProvider === 'custom') {
      const baseUrlResult = await text({
        message: 'API base URL',
        initialValue: apiBaseUrl,
      });
      if (isCancel(baseUrlResult)) process.exit(0);
      apiBaseUrl = (baseUrlResult as string).trim() || 'https://api.openai.com/v1';
    }

    const modelResult = await text({
      message: 'AI model',
      initialValue: model,
    });
    if (isCancel(modelResult)) process.exit(0);
    model = (modelResult as string).trim();

    const maxDiffInput = await text({
      message: 'Max diff characters',
      initialValue: String(maxDiffChars || '8000'),
    });
    if (isCancel(maxDiffInput)) process.exit(0);
    maxDiffChars = parseInt(maxDiffInput as string, 10);

    const maxTokensInput = await text({
      message: 'Max output tokens',
      initialValue: String(maxTokens),
    });
    if (isCancel(maxTokensInput)) process.exit(0);
    maxTokens = parseInt(maxTokensInput as string, 10);

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

  let sections: Section[] = existingConfig.templates || ALL_SECTIONS;
  let autoUpdate = existingConfig.autoUpdate ?? true;

  if (shouldPrompt) {
    const sectionResult = await multiselect({
      message: 'Select section template (space: toggle, enter: done):',
      options: [
        { value: 'summary', label: 'Summary', hint: 'Brief MR/PR description' },
        { value: 'changes', label: 'Changes', hint: 'Features, fixes, removals' },
        { value: 'review', label: 'AI Review', hint: 'Code analysis by AI' },
        { value: 'testing', label: 'Testing', hint: 'Testing checklist' },
        { value: 'notes', label: 'Notes', hint: 'Developer notes (manual)' },
        { value: 'references', label: 'References', hint: 'Issue/ticket links (manual)' },
      ],
      required: true,
      initialValues: sections,
    });
    if (isCancel(sectionResult)) process.exit(0);
    sections = (sectionResult as Section[]).sort((a, b) => ALL_SECTIONS.indexOf(a) - ALL_SECTIONS.indexOf(b));

    if (useCI) {
      const autoUpdateResult = await confirm({
        message: 'Auto-update description when new commits pushed?',
        initialValue: autoUpdate,
      });
      if (isCancel(autoUpdateResult)) process.exit(0);
      autoUpdate = autoUpdateResult as boolean;
    }
  }

  const config: Config = {
    platform,
    aiProvider,
    lang,
    maxDiffChars,
    maxTokens,
    autoUpdate,
    templates: sections,
    providers: {
      [aiProvider]: { apiKey: 'env:AI_API_KEY', model, baseUrl: apiBaseUrl },
    },
    ciTargetBranches: ciTargetBranches?.length ? ciTargetBranches : undefined,
  };

  if (useCI) {
    const mergistDir = resolve(cwd, '.mergist', platform);
    mkdirSync(mergistDir, { recursive: true });

    if (platform === 'gitlab') {
      const gitlabScriptPath = resolve(mergistDir, 'generate.js');
      if (generateScript) {
        writeFileSync(gitlabScriptPath, generateGitLabScript(config, lang));
      } else if (existsSync(gitlabScriptPath)) {
        rmSync(gitlabScriptPath);
      }
      const gitlabPath = resolve(cwd, '.gitlab-ci.yml');
      if (existsSync(gitlabPath)) {
        const existing = readFileSync(gitlabPath, 'utf-8');
        writeFileSync(gitlabPath, mergeGitLabCI(existing, generateGitLabCI(generateScript, config)));
      } else {
        writeFileSync(gitlabPath, generateGitLabCI(generateScript, config));
      }
    } else if (platform === 'github') {
      const githubScriptPath = resolve(mergistDir, 'generate.js');
      if (generateScript) {
        writeFileSync(githubScriptPath, generateGitHubScript(config, lang));
      } else if (existsSync(githubScriptPath)) {
        rmSync(githubScriptPath);
      }
      mkdirSync(resolve(cwd, '.github', 'workflows'), { recursive: true });
      writeFileSync(resolve(cwd, '.github', 'workflows', 'mergist.yml'), generateGitHubWorkflow(generateScript, config));
    }
  }

  saveConfig(config, cwd);

  outro(`Successfully initialized mergist for ${platform}!`);
  if (useCI) {
    printNextSteps(platform, { generateScript, ciTargetBranches });
  } else {
    console.log('\n  CI not configured, to run `npx mergist diff`, add AI_API_KEY to .env in your project root.\n');
  }
}
