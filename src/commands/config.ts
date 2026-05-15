import { Command } from 'commander';
import { loadConfig, saveConfig } from '../config.js';
import type { Platform, Language, Section, AIProvider } from '../types.js';

export const configCommands = new Command('config').description('Show or edit configuration');

configCommands
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig();
    console.log('\n📋 Current Configuration:\n');
    console.log(JSON.stringify(config, null, 2));
    console.log('');
  });

configCommands
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

configCommands
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
