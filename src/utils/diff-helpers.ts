import { c, HUMAN_SECTIONS } from '../constants.js';
import type { Section, Config, DiffFile } from '../types.js';
import type { Lang, PromptType } from '../prompts.js';
import { parseMrPrUrl, type ParsedMrPr } from './url-parser.js';
import { buildTemplate, splitSections, wrapInMarkers } from '../templates/default.js';

export function validateArgs(opts: { from?: string; to?: string; url?: string }): void {
  if (opts.url && (opts.from || opts.to)) {
    throw new Error(
      `Cannot use ${c.cyan('--url')} together with ${c.cyan('-f/-t')}. Choose one.\n\n` +
      `  ${c.cyan('Usage for URL:')}     $ mergist diff ${c.bold('-u <mr/pr-url>')}\n` +
      `  ${c.cyan('Usage for local branches:')}  $ mergist diff ${c.bold('-f <source> -t <target>')}\n`
    );
  }

  if (!opts.url && (opts.from && !opts.to || !opts.from && opts.to)) {
    throw new Error(
      `Both ${c.cyan('-f')} (from/source local branch) and ${c.cyan('-t')} (to/target local branch) are required.\n\n` +
      `  ${c.cyan('Usage:')}  $ mergist diff ${c.bold('-f <source> -t <target>')}\n` +
      `  ${c.cyan('Or using URL:')}  $ mergist diff ${c.bold('-u <mr/pr-url>')}\n`
    );
  }

  if (!opts.url && !opts.from && !opts.to) {
    throw new Error(
      `Missing required arguments.\n\n` +
      `  ${c.cyan('Usage for URL:')}     $ mergist diff ${c.bold('-u <mr/pr-url>')}\n` +
      `  ${c.cyan('Usage for local branches:')}  $ mergist diff ${c.bold('-f <source> -t <target>')}\n`
    );
  }
}

export function parseUrl(url: string, config: Config): ParsedMrPr {
  let parsed: ParsedMrPr;
  try {
    parsed = parseMrPrUrl(url);
  } catch {
    throw new Error(
      `Invalid URL. ${c.cyan('Expected format:')}\n` +
      `  ${c.bold('https://gitlab.com/group/project/-/merge_requests/123')}\n` +
      `  ${c.bold('https://github.com/owner/repo/pull/123')}`
    );
  }

  if (parsed.platform !== config.platform) {
    const target = config.platform === 'gitlab' ? 'GitLab MR' : 'GitHub PR';
    const given = parsed.platform === 'gitlab' ? 'GitLab MR' : 'GitHub PR';
    throw new Error(
      `Expected ${c.cyan(target)} URL, got ${c.cyan(given)}.\n` +
      `  Run ${c.bold('mergist init')} to change platform, or use the correct URL.`
    );
  }

  return parsed;
}

export function formatGitLabDiff(diffs: DiffFile[]): string {
  return diffs
    .map((f) => `--- ${f.old_path}\n+++ ${f.new_path}\n${f.diff}`)
    .join('\n\n');
}

export function formatGitHubDiff(files: any[]): string {
  return files
    .filter((f: any) => f.patch)
    .map((f: any) => `--- ${f.filename}\n+++ ${f.filename}\n${f.patch}`)
    .join('\n\n');
}

export function buildSections(
  description: string,
  sections: Section[],
  type: PromptType,
  lang: Lang,
): string {
  const wrapped = wrapInMarkers(description, sections);
  const parsed = splitSections(wrapped);
  const tmpl = buildTemplate(type, HUMAN_SECTIONS, lang);
  const tmplSections = splitSections(tmpl);
  for (const s of HUMAN_SECTIONS) {
    if (!parsed[s] || parsed[s] === '-') {
      parsed[s] = tmplSections[s];
    }
  }
  return sections.map(s =>
    `<!-- SECTION:${s} -->\n${parsed[s]}\n<!-- ENDSECTION:${s} -->`
  ).join('\n\n');
}

export function titleFromBranch(branch: string): string {
  const parts = branch.split('/');
  const name = parts.length < 2 ? branch : parts.slice(1).join('/');
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}
