export type Platform = 'gitlab' | 'github';
export type AIProvider = 'openai' | 'deepseek' | 'groq' | 'anthropic' | 'custom';

export interface ProviderPreset {
  defaultModel: string;
  baseUrl: string;
}

export const PROVIDER_PRESETS: Record<AIProvider, ProviderPreset> = {
  openai: { defaultModel: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
  deepseek: { defaultModel: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
  groq: { defaultModel: 'llama-3.3-70b-versatile', baseUrl: 'https://api.groq.com/openai/v1' },
  anthropic: { defaultModel: 'claude-sonnet-4-6', baseUrl: 'https://api.anthropic.com/v1' },
  custom: { defaultModel: 'gpt-4o', baseUrl: '' },
};
export type Language = 'id' | 'en';
export type Section = 'summary' | 'changes' | 'review' | 'testing' | 'notes' | 'references';

export interface ProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export interface Config {
  platform: Platform;
  aiProvider: AIProvider;
  lang: Language;
  maxDiffChars: number;
  maxTokens: number;
  autoUpdate: boolean;
  templates: Section[];
  providers: {
    [key: string]: ProviderConfig | undefined;
  };
  ciTargetBranches?: string[];
}

export interface MRInfo {
  id: number;
  title: string;
  description: string;
  web_url: string;
  source_branch: string;
  target_branch: string;
  author: {
    name: string;
    username: string;
  };
}

export interface PRDiffs {
  additions: number;
  changes: number;
  deletions: number;
}

export interface PRInfo {
  id: number;
  number: number;
  title: string;
  body: string;
  html_url: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  user: {
    login: string;
  };
}

export interface DiffFile {
  old_path: string;
  new_path: string;
  diff: string;
}

export interface AIProviderInterface {
  generate(prompt: string, diff: string, systemMessage?: string): Promise<string>;
}