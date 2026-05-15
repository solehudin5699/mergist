export { loadConfig, saveConfig, addPlatform, getConfigPath, getResolvedApiKey } from './config.js';
export { GitLabGenerator } from './generators/gitlab.js';
export { GitHubGenerator } from './generators/github.js';
export { OpenAIProvider } from './providers/index.js';
export { buildTemplate, splitSections } from './templates/default.js';
export type { Config, Platform, AIProvider, MRInfo, PRInfo, DiffFile, Section } from './types.js';
export { AI_SECTIONS, HUMAN_SECTIONS } from './types.js';