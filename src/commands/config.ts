import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { loadConfig, saveConfig, getConfigPath } from '../config.js';
import { generateGitLabCI, generateGitHubWorkflow } from '../templates/ci-templates.js';
import type { Platform, Language, Section, AIProvider } from '../types.js';

export const configCommands = new Command('config').description('Show or edit configuration');

configCommands
  .command('show')
  .description('Show current configuration')
  .action(() => {
    if (!existsSync(getConfigPath())) {
      console.log('No config file found. Run "mergist init" first.');
      return;
    }
    const config = loadConfig();
    console.log('\n📋 Current Configuration:\n');
    console.log(JSON.stringify(config, null, 2));
    console.log('');
  });

configCommands
  .command('get <key>')
  .description('Get a config value')
  .action((key: string) => {
    if (!existsSync(getConfigPath())) {
      console.error('❌ No config file found. Run "mergist init" first.');
      process.exit(1);
    }
    const config = loadConfig();
    const value = (config as unknown as Record<string, unknown>)[key];
    if (value === undefined) {
      console.error(`❌ Unknown key: ${key}`);
      process.exit(1);
    }
    console.log(value);
  });

configCommands
  .command('set <key> <value>')
  .description('Set a config value')
  .action((key: string, value: string) => {
    if (!existsSync(getConfigPath())) {
      console.error('❌ No config file found. Run "mergist init" first.');
      process.exit(1);
    }
    const config = loadConfig();

    if (key === 'platform') {
      if (value !== 'gitlab' && value !== 'github') {
        console.error('❌ Platform must be "gitlab" or "github"');
        process.exit(1);
      }
      config.platform = value as Platform;
    } else if (key === 'maxDiffChars') {
      config.maxDiffChars = parseInt(value, 10);
    } else if (key === 'maxTokens') {
      config.maxTokens = parseInt(value, 10);
    } else if (key === 'aiProvider') {
      const validProviders = ['openai', 'deepseek', 'groq', 'anthropic', 'custom'];
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
        const validSections: Section[] = ['summary', 'changes', 'review', 'testing', 'notes', 'references'];
        config.templates = parsed.filter(s => validSections.includes(s as Section)) as Section[];
        if (config.templates.length === 0) {
          console.error('❌ At least one valid section required');
          process.exit(1);
        }
      } catch {
        console.error('❌ templates must be a JSON array, e.g. ["summary","changes","testing"]');
        process.exit(1);
      }
    } else if (key === 'ciTargetBranches') {
      config.ciTargetBranches = value
        ? value.split(',').map(v => v.trim()).filter(Boolean)
        : undefined;
      if (config.ciTargetBranches?.length === 0) config.ciTargetBranches = undefined;
    } else {
      console.error(`❌ Unknown key: ${key}`);
      console.log('Available keys: platform, maxDiffChars, maxTokens, aiProvider, lang, autoUpdate, templates, ciTargetBranches');
      process.exit(1);
    }

    saveConfig(config);
    console.log(`✅ Updated ${key} = ${value}`);

    if (key === 'platform' || key === 'ciTargetBranches' || (key === 'aiProvider' && config.platform === 'github')) {
      const cwd = process.cwd();
      if (config.platform === 'gitlab') {
        writeFileSync(resolve(cwd, '.gitlab-ci.yml'), generateGitLabCI(false, config));
        console.log('↻ .gitlab-ci.yml regenerated');
      } else {
        const dir = resolve(cwd, '.github', 'workflows');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, 'mergist.yml'), generateGitHubWorkflow(false, config));
        console.log('↻ .github/workflows/mergist.yml regenerated');
      }
    }
  });
