import { createServer, IncomingMessage, ServerResponse } from 'http';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../config.js';
import { loadEnvFile, generateCore, getPlatformRemote, getEnvAiApiKey, initProvider } from './diff.js';
import { titleFromBranch, buildSections } from '../utils/diff-helpers.js';
import { getGitLabApiUrl, getProjectId, createMR, updateMRDescription } from '../api/gitlab.js';
import { parseGitHubRemote, createPR, updatePRDescription } from '../api/github.js';
import type { ParsedMrPr } from '../utils/url-parser.js';
import { c, AI_SECTIONS, HUMAN_SECTIONS, ALL_SECTIONS } from '../constants.js';
import { buildUserPrompt, buildSystemMessage } from '../prompts.js';
import type { PromptType } from '../prompts.js';
import { buildTemplate } from '../templates/default.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

function mime(path: string): string {
  return MIME[extname(path)] || 'application/octet-stream';
}

function getUiHtmlPath(): string {
  const base = fileURLToPath(import.meta.url);
  const dir = dirname(base);
  const candidates = [
    resolve(dir, 'ui/index.html'),
    resolve(dir, '../ui/index.html'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error('ui/index.html not found. Ensure the file exists in src/ui/ or dist/ui/.');
}

function getBranches(): string[] {
  try {
    return execSync('git branch --format="%(refname:short)"', { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function listenOnAvailablePort(
  server: ReturnType<typeof createServer>,
  startPort: number,
): Promise<number> {
  function fallback(reject: (reason: unknown) => void) {
    console.log(`${c.yellow(`⚠ Port ${startPort} unavailable, using random port.`)}`);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolvePort(addr && typeof addr === 'object' ? addr.port : 0);
    });
  }

  let resolvePort: (port: number) => void;

  return new Promise((resolve, reject) => {
    resolvePort = resolve;

    function onError4(err: NodeJS.ErrnoException) {
      if ((err as any).code === 'EADDRINUSE') {
        server.removeListener('error', onError4);
        server.removeListener('listening', onListening4);
        fallback(reject);
      } else {
        reject(err);
      }
    }

    function onListening4() {
      server.removeListener('error', onError4);
      // IPv4 bound. Now check if IPv6 localhost is free.
      const probe = createServer();
      probe.once('error', () => {
        // IPv6 port in use (e.g. Vite) → fallback
        probe.close();
        server.removeListener('listening', onListening4);
        server.close(() => fallback(reject));
      });
      probe.once('listening', () => {
        // IPv6 also free → done
        probe.close(() => resolve(startPort));
      });
      probe.listen(startPort, '::1');
    }

    server.on('error', onError4);
    server.on('listening', onListening4);
    server.listen(startPort, '127.0.0.1');
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

async function handleApiConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const config = loadConfig();
    loadEnvFile();
    const hasToken = config.platform === 'gitlab'
      ? !!process.env.GITLAB_TOKEN
      : !!process.env.GITHUB_TOKEN;
    json(res, 200, {
      ok: true,
      platform: config.platform || null,
      lang: config.lang || null,
      aiProvider: config.aiProvider || null,
      templates: config.templates || null,
      autoUpdate: config.autoUpdate ?? null,
      hasToken,
      branches: getBranches(),
    });
  } catch (err: any) {
    json(res, 200, { ok: false, error: err.message });
  }
}

async function handleApiGenerate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));
    const { from, to, url } = body;

    if (!url && (!from || !to)) {
      json(res, 400, { ok: false, error: 'Provide "from" and "to" (local mode) or "url" (remote mode).' });
      return;
    }

    let config;
    try {
      config = loadConfig();
    } catch {
      json(res, 400, { ok: false, error: 'No configuration found. Run `mergist init` first.' });
      return;
    }

    loadEnvFile();

    const result = await generateCore({ from, to, url }, config);

    if (!result.ok) {
      json(res, 400, {
        ok: false,
        error: result.cleanError || result.error,
        errorType: classifyErrorMsg(result.cleanError || result.error),
      });
      return;
    }

    json(res, 200, {
      ok: true,
      description: result.description,
      sections: result.sections || result.description,
      diff: result.diff,
      fromBranch: result.fromBranch,
      toBranch: result.toBranch,
    });
  } catch (err: any) {
    json(res, 500, { ok: false, error: err.message, errorType: 'connection' });
  }
}

async function handleApiCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));
    const { from, to, description } = body;

    if (!from || !to) {
      json(res, 400, { ok: false, error: '"from" and "to" are required.' });
      return;
    }

    let config;
    try {
      config = loadConfig();
    } catch {
      json(res, 400, { ok: false, error: 'No configuration found.' });
      return;
    }

    loadEnvFile();

    const token = config.platform === 'gitlab'
      ? process.env.GITLAB_TOKEN
      : process.env.GITHUB_TOKEN;

    if (!token) {
      json(res, 400, { ok: false, error: `Set ${config.platform === 'gitlab' ? 'GITLAB_TOKEN' : 'GITHUB_TOKEN'} in .env` });
      return;
    }

    const remoteUrl = getPlatformRemote(config.platform);
    const title = titleFromBranch(from);
    const sections = config.templates || ALL_SECTIONS;
    const finalDesc = description.includes('<!-- SECTION:') ? description : buildSections(description, sections, config.platform === 'gitlab' ? 'mr' : 'pr', config.lang);

    if (config.platform === 'gitlab') {
      const apiUrl = getGitLabApiUrl(remoteUrl);
      const projectId = await getProjectId(token, apiUrl, remoteUrl);
      const mr = await createMR(token, apiUrl, projectId, from, to, title, finalDesc);
      json(res, 200, { ok: true, url: mr.web_url, id: mr.iid });
    } else {
      const { owner, repo } = parseGitHubRemote(remoteUrl);
      const pr = await createPR(token, owner, repo, from, to, title, finalDesc);
      json(res, 200, { ok: true, url: pr.html_url, id: pr.number });
    }
  } catch (err: any) {
    json(res, 500, { ok: false, error: err.message });
  }
}

async function handleApiUpdate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));
    const { url: mrprUrl, description } = body;

    if (!mrprUrl || !description) {
      json(res, 400, { ok: false, error: '"url" and "description" are required.' });
      return;
    }

    let config;
    try {
      config = loadConfig();
    } catch {
      json(res, 400, { ok: false, error: 'No configuration found.' });
      return;
    }

    loadEnvFile();

    const token = config.platform === 'gitlab'
      ? process.env.GITLAB_TOKEN
      : process.env.GITHUB_TOKEN;

    if (!token) {
      json(res, 400, { ok: false, error: `Set ${config.platform === 'gitlab' ? 'GITLAB_TOKEN' : 'GITHUB_TOKEN'} in .env` });
      return;
    }

    const { parseUrl } = await import('../utils/diff-helpers.js');
    const parsed = parseUrl(mrprUrl, config) as ParsedMrPr;
    const sections = config.templates || ALL_SECTIONS;
    const finalDesc = description.includes('<!-- SECTION:') ? description : buildSections(description, sections, config.platform === 'gitlab' ? 'mr' : 'pr', config.lang);

    if (parsed.platform === 'gitlab') {
      const { getProjectIdByPath } = await import('../api/gitlab.js');
      const projectId = await getProjectIdByPath(token, parsed.apiUrl, parsed.projectPath);
      await updateMRDescription(token, parsed.apiUrl, projectId, parsed.mrNumber, finalDesc);
      json(res, 200, { ok: true, url: mrprUrl });
    } else {
      await updatePRDescription(token, parsed.owner, parsed.repo, parsed.prNumber, finalDesc);
      json(res, 200, { ok: true, url: mrprUrl });
    }
  } catch (err: any) {
    json(res, 500, { ok: false, error: err.message });
  }
}

function classifyErrorMsg(msg: string): string {
  if (msg.includes('Token not configured')) return 'token_missing';
  if (msg.includes('AI API key not configured')) return 'api_key_missing';
  if (msg.includes('No changes found')) return 'no_diff';
  return 'unknown';
}

async function handleApiGenerateStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));
    const { from, to, url } = body;

    if (!url && (!from || !to)) {
      json(res, 400, { ok: false, error: 'Provide "from" and "to" (local mode) or "url" (remote mode).' });
      return;
    }

    let config;
    try {
      config = loadConfig();
    } catch {
      json(res, 400, { ok: false, error: 'No configuration found.' });
      return;
    }
    loadEnvFile();

    const result = await generateCore({ from, to, url }, config);
    if (!result.ok) {
      json(res, 400, {
        ok: false,
        error: result.cleanError || result.error,
        errorType: classifyErrorMsg(result.cleanError || result.error),
      });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    res.write(`data: ${JSON.stringify({ type: 'meta', diff: result.diff, fromBranch: result.fromBranch, toBranch: result.toBranch })}\n\n`);

    if (!result.diff) {
      res.write(`data: ${JSON.stringify({ type: 'no_diff', message: result.description || 'No changes found.' })}\n\n`);
      res.end();
      return;
    }

    const apiKey = getEnvAiApiKey(config);
    if (!apiKey) {
      res.write(`data: ${JSON.stringify({ type: 'error', errorType: 'api_key_missing', error: 'AI_API_KEY not configured.' })}\n\n`);
      res.end();
      return;
    }

    const provider = initProvider(apiKey, config);
    const type: PromptType = config.platform === 'gitlab' ? 'mr' : 'pr';
    const sections = config.templates || ALL_SECTIONS;
    const template = buildTemplate(type, sections, config.lang);
    const aiSections = sections.filter(s => AI_SECTIONS.includes(s));
    const humanSections = sections.filter(s => HUMAN_SECTIONS.includes(s));
    const prompt = buildUserPrompt(type, result.fromBranch, template, config.lang, aiSections, humanSections);
    const systemMessage = buildSystemMessage(type, config.lang);

    let fullText = '';
    try {
      for await (const token of provider.generateStream(prompt, result.diff.slice(0, config.maxDiffChars || 8000), systemMessage)) {
        fullText += token;
        res.write(`data: ${JSON.stringify({ type: 'token', text: token })}\n\n`);
      }

      if (!fullText.trim()) {
        res.write(`data: ${JSON.stringify({ type: 'error', errorType: 'ai_empty', error: 'AI returned empty response. Try again or check your AI provider.' })}\n\n`);
        res.end();
        return;
      }

      const finalDesc = buildSections(fullText.trim(), sections, type, config.lang);
      res.write(`data: ${JSON.stringify({ type: 'done', sections: finalDesc, description: fullText.trim().replace(/<!--[\s\S]*?-->/g, '').trim() })}\n\n`);
      res.end();
    } catch (err: any) {
      const status = err.response?.status;
      const apiErr = err.response?.data?.error;
      let errMsg = `AI request failed${status ? ` (${status})` : ''}`;
      if (apiErr?.message) errMsg += `\n  Detail: ${apiErr.message}`;
      res.write(`data: ${JSON.stringify({ type: 'error', errorType: 'ai_failed', error: errMsg })}\n\n`);
      res.end();
    }
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', errorType: 'connection', error: err.message })}\n\n`);
    res.end();
  }
}

async function handleStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const htmlPath = getUiHtmlPath();
    const content = readFileSync(htmlPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': mime(htmlPath) });
    res.end(content);
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error: ' + err.message);
  }
}

export async function uiAction(opts: { port?: string }): Promise<void> {
  const startPort = parseInt(opts.port || '3210', 10);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    try {
      if (path === '/api/config') {
        await handleApiConfig(req, res);
      } else if (path === '/api/generate' && req.method === 'POST') {
        await handleApiGenerate(req, res);
      } else if (path === '/api/generate-stream' && req.method === 'POST') {
        await handleApiGenerateStream(req, res);
      } else if (path === '/api/create' && req.method === 'POST') {
        await handleApiCreate(req, res);
      } else if (path === '/api/update' && req.method === 'POST') {
        await handleApiUpdate(req, res);
      } else {
        await handleStatic(req, res);
      }
    } catch (err: any) {
      json(res, 500, { ok: false, error: err.message });
    }
  });

  const port = await listenOnAvailablePort(server, startPort);

  console.log(`\n${c.green('mergist UI server starting on')} ${c.cyan(`http://localhost:${port}`)}`);
  console.log(`${c.cyan(`Open http://localhost:${port}`)} ${c.gray('in your browser.')}`);
  console.log(c.gray('Press Ctrl+C to stop.'));

  return new Promise(() => {});
}
