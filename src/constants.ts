import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Section } from './types.js';

const pkg = JSON.parse(readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
  'utf-8'
));

export const MAX_TOKENS = 4096;
export const PKG_NAME: string = pkg.name;
export const PKG_VERSION: string = pkg.version;
export const PKG_DESCRIPTION: string = pkg.description;
export const USER_AGENT = `${pkg.name}/${pkg.version}`;

export const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[39m`,
  green: (s: string) => `\x1b[32m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[39m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[39m`,
  gray: (s: string) => `\x1b[38;5;250m${s}\x1b[39m`,
};

export const AI_SECTIONS: Section[] = ['summary', 'changes', 'review', 'testing'];
export const HUMAN_SECTIONS: Section[] = ['notes', 'references'];
export const ALL_SECTIONS: Section[] = ['summary', 'changes', 'review', 'testing', 'notes', 'references'];
