#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { initAction } from './commands/init.js';
import { generateAction } from './commands/generate.js';
import { configCommands } from './commands/config.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

const program = new Command();
program.name(pkg.name).description(pkg.description).version(pkg.version);

program
  .command('init')
  .description('Initialize mr-describe in your project')
  .action(initAction);

program
  .command('generate')
  .description('Generate MR/PR description (for CI)')
  .option('-p, --platform <platform>', 'Platform (gitlab/github)')
  .action(generateAction);

program.addCommand(configCommands);

program.parse();
