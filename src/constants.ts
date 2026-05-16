import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const pkg = JSON.parse(readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
  'utf-8'
));

export const MAX_TOKENS = 4096;
export const PKG_NAME: string = pkg.name;
export const PKG_VERSION: string = pkg.version;
export const PKG_DESCRIPTION: string = pkg.description;
export const USER_AGENT = `${pkg.name}/${pkg.version}`;
