import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Config, Platform } from './types.js';

const sectionSchema = z.enum(['summary', 'changes', 'testing', 'review', 'notes', 'references']);

const providerConfigSchema = z.object({
  apiKey: z.string(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
});

const configSchema = z.object({
  platforms: z.array(z.enum(['gitlab', 'github'])),
  aiProvider: z.enum(['openai']),
  model: z.string().default('gpt-4o'),
  lang: z.enum(['id', 'en']).default('id'),
  maxDiffChars: z.number().default(8000),
  autoUpdate: z.boolean().default(true),
  templates: z.array(sectionSchema).default(['summary', 'changes', 'testing', 'review', 'notes', 'references']),
  providers: z.object({
    openai: providerConfigSchema.optional(),
  }),
});

const defaultConfig: Config = {
  platforms: ['gitlab'],
  aiProvider: 'openai',
  model: 'gpt-4o',
  lang: 'id',
  maxDiffChars: 8000,
  autoUpdate: true,
  templates: ['summary', 'changes', 'testing', 'review', 'notes', 'references'],
  providers: {
    openai: {
      apiKey: 'env:OPENAI_API_KEY',
      model: 'gpt-4o',
    },
  },
};

export function getConfigPath(cwd: string = process.cwd()): string {
  return resolve(cwd, '.mr-describerc');
}

export function loadConfig(cwd: string = process.cwd()): Config {
  const configPath = getConfigPath(cwd);

  if (!existsSync(configPath)) {
    return defaultConfig;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    return configSchema.parse(parsed);
  } catch (error) {
    console.error('Failed to parse config:', error);
    return defaultConfig;
  }
}

export function saveConfig(config: Config, cwd: string = process.cwd()): void {
  const configPath = getConfigPath(cwd);
  const validated = configSchema.parse(config);
  writeFileSync(configPath, JSON.stringify(validated, null, 2));
}

export function addPlatform(platform: Platform, cwd: string = process.cwd()): Config {
  const config = loadConfig(cwd);

  if (!config.platforms.includes(platform)) {
    config.platforms.push(platform);
    saveConfig(config, cwd);
  }

  return config;
}

export function getResolvedApiKey(config: Config): string | null {
  const provider = config.providers[config.aiProvider];

  if (!provider?.apiKey) {
    return null;
  }

  if (provider.apiKey.startsWith('env:')) {
    const envVar = provider.apiKey.slice(4);
    return process.env[envVar] || null;
  }

  return provider.apiKey;
}
