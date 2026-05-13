/**
 * generate-mr-desc.js
 * Auto-generate GitLab MR description using Claude API
 *
 * Required CI variables:
 *   ANTHROPIC_API_KEY  - Anthropic API key
 *   GITLAB_TOKEN       - GitLab Project Access Token (scope: api)
 *
 * Provided automatically by GitLab CI:
 *   GITLAB_API_V4_URL
 *   CI_PROJECT_ID
 *   CI_MERGE_REQUEST_IID
 */

'use strict';

const https = require('https');

// ── Config ─────────────────────────────────────────────────────────────────

const { ANTHROPIC_API_KEY, GITLAB_TOKEN, CI_PROJECT_ID, CI_MERGE_REQUEST_IID, GITLAB_API_V4_URL } =
  process.env;

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const MAX_DIFF_CHARS = 8000;
const MAX_TOKENS = 1000;

const MR_TEMPLATE = `## Judul MR
<!-- Ringkasan singkat tujuan MR ini -->

## Daftar perubahan

### Fitur baru
- 

### Update / perbaikan
- 

### Dihapus
- 

## Testing
- [ ] Sudah ditest secara lokal
- [ ] Tidak ada breaking change

## Referensi
Closes #`;

// ── Logger ─────────────────────────────────────────────────────────────────

const log = {
  info: (msg) => console.log(`[MR Generator] ℹ ${msg}`),
  success: (msg) => console.log(`[MR Generator] ✓ ${msg}`),
  warn: (msg) => console.warn(`[MR Generator] ⚠ ${msg}`),
  error: (msg) => console.error(`[MR Generator] ✗ ${msg}`),
};

// ── HTTP helper ────────────────────────────────────────────────────────────

function httpRequest(url, options, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;

    const reqOptions = {
      ...options,
      headers: {
        ...options.headers,
        ...(payload && { 'Content-Length': Buffer.byteLength(payload) }),
      },
    };

    const req = https.request(url, reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Validation ─────────────────────────────────────────────────────────────

function validateEnv() {
  const required = {
    ANTHROPIC_API_KEY,
    GITLAB_TOKEN,
    CI_PROJECT_ID,
    CI_MERGE_REQUEST_IID,
    GITLAB_API_V4_URL,
  };

  const missing = Object.entries(required)
    .filter(([, val]) => !val)
    .map(([key]) => key);

  if (missing.length > 0) {
    console.error('ENV CHECK:', {
      hasAnthropic: !!ANTHROPIC_API_KEY,
      hasGitlab: !!GITLAB_TOKEN,
      projectId: !!CI_PROJECT_ID,
      mrIid: !!CI_MERGE_REQUEST_IID,
      apiUrl: !!GITLAB_API_V4_URL,
    });

    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// ── GitLab API ─────────────────────────────────────────────────────────────

const gitlabHeaders = () => {
  if (!GITLAB_TOKEN) {
    throw new Error('GITLAB_TOKEN is missing');
  }

  return {
    'Content-Type': 'application/json',
    'PRIVATE-TOKEN': GITLAB_TOKEN,
  };
};

const mrBaseUrl = () =>
  `${GITLAB_API_V4_URL}/projects/${CI_PROJECT_ID}/merge_requests/${CI_MERGE_REQUEST_IID}`;

async function getMRInfo() {
  log.info('Mengambil info MR...');

  const res = await httpRequest(mrBaseUrl(), {
    method: 'GET',
    headers: gitlabHeaders(),
  });

  if (res.status !== 200) {
    throw new Error(`Gagal ambil info MR (HTTP ${res.status}): ${JSON.stringify(res.body)}`);
  }

  return res.body;
}

async function getMRDiff() {
  log.info('Mengambil diff MR...');

  const url = `${mrBaseUrl()}/diffs`;
  const res = await httpRequest(url, {
    method: 'GET',
    headers: gitlabHeaders(),
  });

  if (res.status !== 200) {
    throw new Error(`Gagal ambil diff MR (HTTP ${res.status}): ${JSON.stringify(res.body)}`);
  }

  const diff = res.body.map((f) => `--- ${f.old_path}\n+++ ${f.new_path}\n${f.diff}`).join('\n\n');

  return diff;
}

async function updateMRDescription(description) {
  log.info('Mengupdate deskripsi MR...');

  const res = await httpRequest(
    mrBaseUrl(),
    { method: 'PUT', headers: gitlabHeaders() },
    { description },
  );

  if (res.status !== 200) {
    throw new Error(`Gagal update deskripsi MR (HTTP ${res.status}): ${JSON.stringify(res.body)}`);
  }

  return res.body;
}

// ── Claude API ─────────────────────────────────────────────────────────────

async function generateDescription(diff, mrTitle) {
  log.info('Generating deskripsi via Claude API...');

  const context = mrTitle ? `Judul MR yang dibuat developer: "${mrTitle}"\n\n` : '';

  const res = await httpRequest(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
    },
    {
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: `Kamu adalah asisten yang membantu developer mengisi deskripsi Merge Request secara otomatis.

Tugasmu adalah menganalisis git diff berikut dan mengisi template MR dengan tepat.

Aturan:
- Gunakan bahasa Indonesia
- Isi setiap section berdasarkan perubahan nyata di diff
- Jika tidak ada perubahan untuk suatu section, tulis hanya tanda "-"
- Untuk section Testing, tambahkan checklist spesifik berdasarkan perubahan
- Kembalikan HANYA template yang sudah diisi, tanpa penjelasan tambahan

${context}GIT DIFF:
${diff.slice(0, MAX_DIFF_CHARS)}

TEMPLATE YANG HARUS DIISI:
${MR_TEMPLATE}`,
        },
      ],
    },
  );

  if (res.status !== 200) {
    throw new Error(`Claude API error (HTTP ${res.status}): ${JSON.stringify(res.body)}`);
  }

  return res.body.content
    .map((b) => b.text || '')
    .join('')
    .trim();
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  log.info('Mulai...');

  // 1. Validasi environment variables
  validateEnv();

  // 2. Ambil info MR
  const mrInfo = await getMRInfo();
  const mrTitle = mrInfo.title || '';

  // 3. Cek apakah deskripsi sudah diisi developer
  //    Jika sudah ada isi (bukan kosong / hanya whitespace), skip
  if (mrInfo.description && mrInfo.description.trim().length > 0) {
    log.warn('Deskripsi MR sudah diisi oleh developer, dilewati.');
    log.warn(`Isi saat ini: "${mrInfo.description.slice(0, 80)}..."`);
    process.exit(0);
  }

  // 4. Ambil diff
  const diff = await getMRDiff();

  if (!diff.trim()) {
    log.warn('Tidak ada diff yang ditemukan, dilewati.');
    process.exit(0);
  }

  log.info(`Ukuran diff: ${diff.length} karakter`);

  // 5. Generate deskripsi
  const description = await generateDescription(diff, mrTitle);

  // 6. Update deskripsi MR
  await updateMRDescription(description);

  log.success('Deskripsi MR berhasil diupdate!');
  log.success(`MR: ${mrInfo.web_url}`);
}

main().catch((err) => {
  log.error(err.message);
  // Exit 0 agar pipeline tidak gagal karena script ini
  // Perubahan kode tetap bisa di-review meski deskripsi tidak ter-generate
  process.exit(0);
});
