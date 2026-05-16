import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

export const MAX_TOKENS = 4096;
export const PKG_NAME: string = pkg.name;
export const PKG_VERSION: string = pkg.version;
export const PKG_DESCRIPTION: string = pkg.description;
export const USER_AGENT = `${pkg.name}/${pkg.version}`;
