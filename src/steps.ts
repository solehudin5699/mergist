import type { Platform } from './types.js';

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[39m`,
  green: (s: string) => `\x1b[32m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[39m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[39m`,
  gray: (s: string) => `\x1b[38;5;250m${s}\x1b[39m`,
};

type Step = { num: string; title: string; details: string[] };

const steps: Record<Platform, Step[]> = {
  gitlab: [
    {
      num: '1',
      title: 'Create GitLab token for MR API access:',
      details: [
        `${c.gray('Go to your project on GitLab')}`,
        `${c.gray('Settings → Access Tokens → Add new token')}`,
        `Name: ${c.green('mergist')} | Role: ${c.green('Developer')} | Scope: ${c.green('api')}`,
        `${c.yellow('Copy the generated token value')} — you\u2019ll need it in step 2`,
      ],
    },
    {
      num: '2',
      title: `Add variables to GitLab CI/CD:`,
      details: [
        `${c.gray('Settings → CI/CD → Runners → Expand → go to Instance tab')}`,
        `${c.gray('Ensure "Turn on instance runners for this project" is toggled ON')}`,
        '',
        `${c.gray('Settings → CI/CD → Variables → Expand → Add variable')}`,
        '',
        `${c.bold('Variable 1:')} ${c.cyan('AI_API_KEY')} | Value: ${c.yellow('<your AI key>')}`,
        `${c.gray('Type: Variable | Protected: uncheck | Masked: Yes')}`,
        '',
        `${c.bold('Variable 2:')} ${c.cyan('GITLAB_TOKEN')} | Value: ${c.yellow('<token from step 1>')}`,
        `${c.gray('Type: Variable | Protected: uncheck | Masked: Yes')}`,
      ],
    },
    {
      num: '3',
      title: 'Commit generated files to your target branch:',
      details: [
        `${c.yellow('git add .gitlab-ci.yml .mergistrc .mergist/')}`,
        `${c.yellow('git commit -m "chore: init mergist"')}`,
        `${c.yellow('git push origin')} ${c.magenta('<target-branch>')}`,
      ],
    },
    {
      num: '4',
      title: 'Create a Merge Request targeting that branch.',
      details: ['CI will auto-generate the description.'],
    },
  ],
  github: [
    {
      num: '1',
      title: `Add ${c.cyan('AI_API_KEY')} to GitHub Actions secrets:`,
      details: [
        `${c.gray('Go to your repository on GitHub')}`,
        `${c.gray('Settings → Secrets and variables → Actions → New repository secret')}`,
        `Name: ${c.cyan('AI_API_KEY')} | Value: ${c.yellow('<your AI key>')}`,
      ],
    },
    {
      num: '2',
      title: 'Ensure workflow has write permission:',
      details: [
        `${c.gray('Go to your repository on GitHub')}`,
        `${c.gray('Settings → Actions → General → Workflow permissions')}`,
        `Select ${c.green('"Read and write permissions"')} → ${c.green('Save')}`,
      ],
    },
    {
      num: '3',
      title: 'Commit generated files to your target branch:',
      details: [
        `${c.yellow('git add .github/workflows/mergist.yml .mergistrc .mergist/')}`,
        `${c.yellow('git commit -m "chore: init mergist"')}`,
        `${c.yellow('git push origin')} ${c.magenta('<target-branch>')}`,
      ],
    },
    {
      num: '4',
      title: 'Create a Pull Request targeting that branch.',
      details: ['CI will auto-generate the description.'],
    },
  ],
};

export function printNextSteps(platform: Platform, opts: { generateScript: boolean; ciTargetBranches?: string[] }): void {
  console.log('Next steps:\n');
  for (const step of steps[platform]) {
    console.log(`${c.bold(`${step.num}. ${step.title}`)}`);
    for (const detail of step.details) console.log(`   ${detail}`);
    console.log('');
  }
  if (opts.generateScript) {
    console.log(`${c.yellow(`Standalone script at .mergist/${platform}/generate.js`)} — ensure it is committed.\n`);
  }
  if (opts.ciTargetBranches?.length) {
    console.log(`${c.gray(`CI limited to: ${opts.ciTargetBranches.join(', ')}`)}`);
  }
}
