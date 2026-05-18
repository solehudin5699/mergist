import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Config } from './types.js';
import { MAX_TOKENS } from './constants.js';

const sectionSchema = z.enum(['summary', 'changes', 'review', 'testing', 'notes', 'references']);

const providerConfigSchema = z.object({
  apiKey: z.string(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
});

const configSchema = z.object({
  platform: z.enum(['gitlab', 'github']).default('gitlab'),
  aiProvider: z.enum(['openai', 'deepseek', 'groq', 'custom']).default('openai'),
  lang: z.enum(['id', 'en']).default('id'),
  maxDiffChars: z.number().default(8000),
  maxTokens: z.number().int().positive().default(MAX_TOKENS),
  autoUpdate: z.boolean().default(true),
  templates: z.array(sectionSchema).default(['summary', 'changes', 'review', 'testing', 'notes', 'references']),
  providers: z.record(z.string(), providerConfigSchema.optional()),
  ciTargetBranches: z.array(z.string()).optional(),
});

const defaultConfig: Config = {
  platform: 'gitlab',
  aiProvider: 'openai',
  lang: 'id',
  maxDiffChars: 8000,
  maxTokens: MAX_TOKENS,
  autoUpdate: true,
  templates: ['summary', 'changes', 'review', 'testing', 'notes', 'references'],
  providers: {
    openai: {
      apiKey: 'env:AI_API_KEY',
      model: 'gpt-4o',
    },
  },
};

export function getConfigPath(cwd: string = process.cwd()): string {
  return resolve(cwd, '.mergistrc');
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



