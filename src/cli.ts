#!/usr/bin/env node

import { Command } from 'commander';
import { initAction } from './commands/init.js';
import { generateAction } from './commands/generate.js';
import { diffAction } from './commands/diff.js';
import { configCommands } from './commands/config.js';
import { PKG_NAME, PKG_DESCRIPTION, PKG_VERSION } from './constants.js';

const program = new Command();
program.name(PKG_NAME).description(PKG_DESCRIPTION).version(PKG_VERSION);

program
  .command('init')
  .description('Initialize mergist in your project')
  .action(initAction);

program
  .command('generate')
  .description('Generate MR/PR description (for CI)')
  .option('-p, --platform <platform>', 'Platform (gitlab/github)')
  .action(generateAction);

program.addCommand(configCommands);

program
  .command('diff')
  .description('Preview description from local git diff or MR/PR URL')
.option('-f, --from <branch>', 'Local source branch (required without --url)')
.option('-t, --to <branch>', 'Local target branch (required without --url)')
  .option('-u, --url <url>', 'MR/PR URL (required without -f/-t)')
  .action(diffAction);

program.parse();
