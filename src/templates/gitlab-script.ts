import { buildSystemMessage, buildPromptScriptTemplate } from '../prompts.js';
import { buildTemplate } from './default.js';
import type { Config, Language } from '../types.js';
import { PROVIDER_PRESETS } from '../types.js';

export function generateGitLabScript(config: Config, lang: Language): string {
  const systemMessage = buildSystemMessage('mr', lang);
  const generatedPrompt = buildPromptScriptTemplate('mr', lang);
  const sections = config.templates || ['summary', 'changes', 'testing', 'review', 'notes', 'references'];
  const type = 'mr';
  const template = buildTemplate(type, sections, lang);
  const providerKey = config.aiProvider || 'openai';
  const providerCfg = config.providers[providerKey] || { apiKey: 'env:AI_API_KEY', baseUrl: '', model: '' };
  const envVarName = providerCfg.apiKey?.replace(/^env:/, '') || 'AI_API_KEY';
  const model = providerCfg.model || 'gpt-4o';
  const baseUrl = providerCfg.baseUrl || PROVIDER_PRESETS[providerKey]?.baseUrl || 'https://api.openai.com/v1';

  return `/**
 * generate.js — GitLab MR
 * Auto-generate GitLab MR description using ${providerKey}
 */

const https = require('https');

const { GITLAB_TOKEN, CI_PROJECT_ID, CI_MERGE_REQUEST_IID, CI_API_V4_URL, ${envVarName}: AI_API_KEY } = process.env;

const MODEL = '${model}';
const MAX_DIFF_CHARS = ${config.maxDiffChars};
const SYSTEM_MESSAGE = ${JSON.stringify(systemMessage)};

const SECTIONS = ${JSON.stringify(sections)};
const AI_SECTIONS = ['summary', 'changes', 'testing', 'review'];
const HUMAN_SECTIONS = ['notes', 'references'];
const AUTO_UPDATE = ${config.autoUpdate};

const BASE_URL = '${baseUrl}';

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
  if (text.includes('<!-- SECTION:')) return text;
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
        console.log(\`[MR Generator] Rate limited, retrying in \${delay}ms...\`);
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

function getHeaders() {
  return { 'Content-Type': 'application/json', 'PRIVATE-TOKEN': GITLAB_TOKEN };
}

async function getMRInfo() {
  const url = \`\${CI_API_V4_URL}/projects/\${CI_PROJECT_ID}/merge_requests/\${CI_MERGE_REQUEST_IID}\`;
  const res = await httpRequest(url, { method: 'GET', headers: getHeaders() });
  if (res.status !== 200) throw new Error(\`Failed to get MR info (HTTP \${res.status})\`);
  return res.body;
}

async function getMRDiff() {
  const url = \`\${CI_API_V4_URL}/projects/\${CI_PROJECT_ID}/merge_requests/\${CI_MERGE_REQUEST_IID}/diffs\`;
  const res = await httpRequest(url, { method: 'GET', headers: getHeaders() });
  if (res.status !== 200) throw new Error(\`Failed to get MR diff (HTTP \${res.status})\`);
  return res.body.map((f) => \`--- \${f.old_path}\\n+++ \${f.new_path}\\n\${f.diff}\`).join('\\n\\n');
}

async function updateMRDescription(desc) {
  const url = \`\${CI_API_V4_URL}/projects/\${CI_PROJECT_ID}/merge_requests/\${CI_MERGE_REQUEST_IID}\`;
  const res = await httpRequest(url, { method: 'PUT', headers: getHeaders() }, { description: desc });
  if (res.status !== 200) throw new Error(\`Failed to update MR (HTTP \${res.status})\`);
}

async function callAI(prompt, diff) {
  const res = await httpRequest(BASE_URL + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${AI_API_KEY}\` }
  }, { model: MODEL, max_tokens: 1000, messages: [{ role: 'system', content: SYSTEM_MESSAGE }, { role: 'user', content: prompt + '\\n\\nGIT DIFF:\\n' + diff.slice(0, MAX_DIFF_CHARS) }] });
  if (res.status !== 200) {
    const err = new Error(\`AI error (HTTP \${res.status})\`);
    err.status = res.status;
    throw err;
  }
  return res.body.choices[0]?.message?.content?.trim() || '';
}

async function main() {
  console.log('[MR Generator] Memulai...');
  const mrInfo = await getMRInfo();
  const hasDesc = mrInfo.description?.trim().length > 0;

  if (hasDesc && !AUTO_UPDATE) { console.log('[MR Generator] Deskripsi sudah ada, autoUpdate=false, dilewati.'); return; }

  const diff = await getMRDiff();
  if (!diff.trim()) { console.log('[MR Generator] Tidak ada diff, dilewati.'); return; }
  const title = mrInfo.title;
  const template = TEMPLATE;
  const prompt = \`${generatedPrompt}\`;
  const desc = await withRetry(() => callAI(prompt, diff));
  const wrappedDesc = desc.includes('<!-- SECTION:') ? desc : wrapInMarkers(desc, SECTIONS);

  const finalDesc = hasDesc ? preserveHumanSections(wrappedDesc, mrInfo.description) : wrappedDesc;
  await updateMRDescription(finalDesc);
  console.log('[MR Generator] ✓ Deskripsi MR berhasil diupdate!');
}

main().catch(err => { console.error('[MR Generator] ✗', err.message); process.exit(0); });`;
}
