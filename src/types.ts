export type Platform = 'gitlab' | 'github';
export type AIProvider = 'openai';

export interface ProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export interface Config {
  platforms: Platform[];
  aiProvider: AIProvider;
  model: string;
  maxDiffChars: number;
  providers: {
    openai?: ProviderConfig;
  };
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