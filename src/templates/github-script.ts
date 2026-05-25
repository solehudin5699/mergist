import { buildSystemMessage, buildPromptScriptTemplate } from '../prompts.js';
import { buildTemplate } from './default.js';
import type { Config, Language } from '../types.js';
import { PROVIDER_PRESETS } from '../types.js';
import { MAX_TOKENS, USER_AGENT, HUMAN_SECTIONS, ALL_SECTIONS } from '../constants.js';

export function generateGitHubScript(config: Config, lang: Language): string {
  const sections = config.templates || ALL_SECTIONS;
  const systemMessage = buildSystemMessage('pr', lang);
  const generatedPrompt = buildPromptScriptTemplate('pr', lang);
  const type = 'pr';
  const template = buildTemplate(type, sections, lang);
  const providerKey = config.aiProvider || 'openai';
  const providerCfg = config.providers[providerKey] || { apiKey: 'env:AI_API_KEY', baseUrl: '', model: '' };
  const envVarName = providerCfg.apiKey?.replace(/^env:/, '') || 'AI_API_KEY';
  const model = providerCfg.model || PROVIDER_PRESETS[providerKey]?.defaultModel || 'gpt-4o';
  const baseUrl = providerCfg.baseUrl || PROVIDER_PRESETS[providerKey]?.baseUrl || 'https://api.openai.com/v1';

  return `/**
 * generate.js — GitHub PR
 * Auto-generate GitHub PR description using ${providerKey}
 */

const https = require('https');

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_PR_NUMBER, ${envVarName}: AI_API_KEY } = process.env;
const [OWNER, REPO] = GITHUB_REPOSITORY.split('/');

const MODEL = '${model}';
const MAX_DIFF_CHARS = ${config.maxDiffChars};
const SYSTEM_MESSAGE = ${JSON.stringify(systemMessage)};

const SECTIONS = ${JSON.stringify(sections)};
const HUMAN_SECTIONS = ${JSON.stringify(HUMAN_SECTIONS)};
const AUTO_UPDATE = ${config.autoUpdate};

const BASE_URL = '${baseUrl}';
const PROVIDER = '${providerKey}';

const TEMPLATE = \`${template.replace(/`/g, '\\`')}\`;

const SECTION_HEADINGS = {
  summary: ['## Ringkasan', '## Summary'],
  changes: ['## Daftar Perubahan', '## Changes'],
  testing: ['## Testing'],
  review: ['## AI Review'],
  notes: ['## Catatan', '## Notes'],
  references: ['## Referensi', '## References'],
};

function wrapInMarkers(text, sections) {
  if (text.includes('<!-- SECTION:')) {
    const existing = splitSections(text);
    return sections.map(s =>
      \`<!-- SECTION:\${s} -->\\n\${existing[s] || '-'}\\n<!-- ENDSECTION:\${s} -->\`
    ).join('\\n\\n');
  }
  const parts = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const headings = SECTION_HEADINGS[s] || [\`## \${s}\`];
    const heading = headings.find(h => text.includes(h));
    if (!heading) {
      parts.push(\`<!-- SECTION:\${s} -->\\n-\\n<!-- ENDSECTION:\${s} -->\`);
      continue;
    }
    const headingIdx = text.indexOf(heading);
    const afterHeading = text.slice(headingIdx + heading.length);
    const nextSections = sections.slice(i + 1);
    const nextHeading = nextSections.map(s2 => SECTION_HEADINGS[s2]).flat().find(h => afterHeading.includes(h));
    const content = nextHeading
      ? afterHeading.slice(0, afterHeading.indexOf(nextHeading)).trim()
      : afterHeading.trim();
    parts.push(\`<!-- SECTION:\${s} -->\\n\${heading}\\n\${content || '-'}\\n<!-- ENDSECTION:\${s} -->\`);
  }
  return parts.join('\\n\\n');
}

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i < retries - 1 && err.status === 429) {
        const delay = Math.pow(2, i) * 1000;
        console.log(\`[PR Generator] Rate limited, retrying in \${delay}ms...\`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

function splitSections(description) {
  const sections = {};
  const re = /<!-- SECTION:(\\w+) -->\\n?([\\s\\S]*?)\\n?<!-- ENDSECTION:\\1 -->/g;
  let match;
  while ((match = re.exec(description)) !== null) {
    sections[match[1]] = match[2].trim();
  }
  return sections;
}

function preserveHumanSections(newDesc, existingDesc) {
  const newSections = splitSections(newDesc);
  const existingSections = splitSections(existingDesc);
  for (const section of SECTIONS) {
    if (HUMAN_SECTIONS.includes(section) && existingSections[section]) {
      newSections[section] = existingSections[section];
    }
  }
  return SECTIONS.map(s => {
    const content = newSections[s];
    return content
      ? \`<!-- SECTION:\${s} -->\\n\${content}\\n<!-- ENDSECTION:\${s} -->\`
      : \`<!-- SECTION:\${s} -->\\n-<!-- ENDSECTION:\${s} -->\`;
  }).join('\\n\\n');
}

function enrichHumanSections(desc) {
  const sections = splitSections(desc);
  const tmplSections = splitSections(TEMPLATE);
  for (const s of HUMAN_SECTIONS) {
    if (!sections[s] || sections[s] === '-') {
      sections[s] = tmplSections[s];
    }
  }
  return SECTIONS.map(s => {
    const content = sections[s];
    return content
      ? \`<!-- SECTION:\${s} -->\\n\${content}\\n<!-- ENDSECTION:\${s} -->\`
      : \`<!-- SECTION:\${s} -->\\n-\\n<!-- ENDSECTION:\${s} -->\`;
  }).join('\\n\\n');
}

function httpRequest(url, options, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { ...options.headers };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(url, { ...options, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getPRInfo() {
  const res = await httpRequest(\`https://api.github.com/repos/\${OWNER}/\${REPO}/pulls/\${GITHUB_PR_NUMBER}\`, {
    method: 'GET',
    headers: { 'Authorization': \`Bearer \${GITHUB_TOKEN}\`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': '${USER_AGENT}' }
  });
  if (res.status !== 200) throw new Error(\`Failed to get PR info (HTTP \${res.status})\`);
  return res.body;
}

async function getPRDiff() {
  const res = await httpRequest(\`https://api.github.com/repos/\${OWNER}/\${REPO}/pulls/\${GITHUB_PR_NUMBER}/files\`, {
    method: 'GET',
    headers: { 'Authorization': \`Bearer \${GITHUB_TOKEN}\`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': '${USER_AGENT}' }
  });
  if (res.status !== 200) throw new Error(\`Failed to get PR diff (HTTP \${res.status})\`);
  return res.body.map(f => f.patch ? \`--- \${f.filename}\\n+++ \${f.filename}\\n\${f.patch}\` : '').filter(Boolean).join('\\n\\n');
}

async function updatePRDescription(desc) {
  await httpRequest(\`https://api.github.com/repos/\${OWNER}/\${REPO}/pulls/\${GITHUB_PR_NUMBER}\`, {
    method: 'PATCH',
    headers: { 'Authorization': \`Bearer \${GITHUB_TOKEN}\`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': '${USER_AGENT}' }
  }, { body: desc });
}

async function callAI(prompt, diff) {
  if (PROVIDER === 'anthropic') {
    const res = await httpRequest('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': AI_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    }, { model: MODEL, max_tokens: ${config.maxTokens || MAX_TOKENS}, system: SYSTEM_MESSAGE, messages: [{ role: 'user', content: prompt + '\\n\\nGIT DIFF:\\n' + diff.slice(0, MAX_DIFF_CHARS) }] });
    if (res.status !== 200) {
      const err = new Error(\`AI error (HTTP \${res.status})\`);
      err.status = res.status;
      throw err;
    }
    return res.body.content[0]?.text?.trim() || '';
  } else {
    const res = await httpRequest(BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${AI_API_KEY}\` }
    }, { model: MODEL, max_tokens: ${config.maxTokens || MAX_TOKENS}, messages: [{ role: 'system', content: SYSTEM_MESSAGE }, { role: 'user', content: prompt + '\\n\\nGIT DIFF:\\n' + diff.slice(0, MAX_DIFF_CHARS) }] });
    if (res.status !== 200) {
      const err = new Error(\`AI error (HTTP \${res.status})\`);
      err.status = res.status;
      throw err;
    }
    return res.body.choices[0]?.message?.content?.trim() || '';
  }
}

async function main() {
  console.log('[PR Generator] Memulai...');
  const prInfo = await getPRInfo();
  const hasDesc = prInfo.body?.trim().length > 0;

  if (hasDesc && !AUTO_UPDATE) { console.log('[PR Generator] PR description already exists, autoUpdate=false, skipped.'); return; }

  const diff = await getPRDiff();
  if (!diff.trim()) { console.log('[PR Generator] No diff, skipped.'); return; }
  const title = prInfo.title;
  const template = TEMPLATE;
  const prompt = \`${generatedPrompt}\`;
  const desc = await withRetry(() => callAI(prompt, diff));
  const wrappedDesc = wrapInMarkers(desc, SECTIONS);
  const enrichedDesc = enrichHumanSections(wrappedDesc);

  const finalDesc = hasDesc ? preserveHumanSections(enrichedDesc, prInfo.body) : enrichedDesc;
  await updatePRDescription(finalDesc);
  console.log('[PR Generator] ✓ PR description updated!');
}

main().catch(err => { console.error('[PR Generator] ✗', err.message); process.exit(0); });`;
}
