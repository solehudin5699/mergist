import { AI_SECTIONS, HUMAN_SECTIONS } from './constants.js';
import type { Section } from './types.js';

export type Lang = 'id' | 'en';
export type PromptType = 'mr' | 'pr';

const SECTION_LABELS: Record<Section, Record<Lang, string>> = {
  summary: { id: 'Ringkasan', en: 'Summary' },
  changes: { id: 'Daftar Perubahan', en: 'Changes' },
  testing: { id: 'Testing', en: 'Testing' },
  review: { id: 'AI Review', en: 'AI Review' },
  notes: { id: 'Catatan', en: 'Notes' },
  references: { id: 'Referensi', en: 'References' },
};

function formatSectionList(sections: Section[], lang: Lang): string {
  const labels = sections.map(s => SECTION_LABELS[s][lang]);
  if (labels.length <= 1) return labels[0] || '';
  if (labels.length === 2) return `${labels[0]} ${lang === 'id' ? 'dan' : 'and'} ${labels[1]}`;
  const comma = labels.slice(0, -1).join(', ');
  return `${comma} ${lang === 'id' ? 'dan' : 'and'} ${labels[labels.length - 1]}`;
}

const translations: Record<Lang, {
  system: string;
  task: string;
  rules: string;
  instructions: [string, string, string, string, string, string, string, string, string];
  title: string;
  template: string;
}> = {
  id: {
    system: 'Kamu adalah asisten AI code reviewer yang membantu developer mengisi deskripsi __LABEL__ secara otomatis dengan analisis teknis yang detail.',
    task: 'Tugasmu adalah menganalisis git diff berikut dan mengisi template __SHORT_LABEL__ dengan tepat.',
    rules: 'Aturan:',
    instructions: [
      'Gunakan bahasa Indonesia',
      'Isi setiap section berdasarkan perubahan nyata di diff',
      'Untuk section Daftar Perubahan, tulis setiap perubahan sebagai flat list:\n- ✨ **Add** — Menambah <deskripsi> (<file:line>)\n- 🔧 **Change** — Mengubah/Memperbaiki <deskripsi> (<file:line>)\n- 🔥 **Remove** — Menghapus <deskripsi> (<file:line>)\nGunakan kata kerja aktif yang sesuai (Menambah, Mengubah, Memperbaiki, Menghapus, Memindahkan, Mengganti, dll)',
      'Jika tidak ada perubahan untuk suatu section, tulis hanya tanda "-"',
      'Untuk section Testing, tambahkan checklist spesifik berdasarkan perubahan',
      'Untuk section AI Review, tulis analisis dengan struktur berikut:\nBaris pertama: ringkasan singkat kualitas perubahan secara umum\nKemudian temuan dalam format flat list:\n- 🔴 **Risk** — <masalah> di <file:line>. <saran perbaikan>\n- 🟡 **Warn** — <masalah> di <file:line>. <saran perbaikan>\n- 🔵 **Suggestion** — <masalah/saran> di <file:line>. <penjelasan>\n- 🟢 **Good** — <kode bagus> di <file:line>. <alasan>\nJika tidak ada temuan untuk suatu kategori, lewati (jangan ditulis)\nWajib menyebutkan: file dengan perubahan terbanyak dan 1 potensi risiko tertinggi',
      'Hanya isi section __AI_SECTIONS__. Biarkan __HUMAN_SECTIONS__ apa adanya',
      'Kembalikan HANYA template yang sudah diisi, tanpa penjelasan tambahan',
      'Untuk section Referensi, biarkan kosong — diisi manual oleh developer, reviewer, atau lainnya terkait issue links, tickets, documentation, dll',
    ],
    title: 'Judul __SHORT_LABEL__: "__TITLE__"',
    template: 'TEMPLATE YANG HARUS DIISI:\n__TEMPLATE__',
  },
  en: {
    system: 'You are an AI code review assistant that helps developers fill __LABEL__ descriptions automatically with detailed technical analysis.',
    task: 'Your task is to analyze the following git diff and fill the __SHORT_LABEL__ template correctly.',
    rules: 'Rules:',
    instructions: [
      'Use English',
      'Fill each section based on actual changes in the diff',
      'For Changes section, write each change as a flat list:\n- ✨ **Add** — Add <description> (<file:line>)\n- 🔧 **Change** — Change/Fix <description> (<file:line>)\n- 🔥 **Remove** — Remove <description> (<file:line>)\nUse active verbs (Add, Change, Fix, Remove, Move, Replace, etc)',
      'If no changes for a section, write only "-"',
      'For Testing section, add specific checklist based on changes',
      'For AI Review section, write analysis with the following structure:\nFirst line: brief summary of overall change quality\nThen findings as a flat list:\n- 🔴 **Risk** — <issue> at <file:line>. <fix suggestion>\n- 🟡 **Warn** — <issue> at <file:line>. <fix suggestion>\n- 🔵 **Suggestion** — <issue/suggestion> at <file:line>. <explanation>\n- 🟢 **Good** — <good code> at <file:line>. <reason>\nIf no findings for a category, skip it (do not write it)\nMust mention: file with most changes and 1 highest potential risk',
      'Only fill sections: __AI_SECTIONS__. Leave __HUMAN_SECTIONS__ as-is',
      'Return ONLY the filled template, without additional explanation',
      'For References section, leave empty — filled manually by developer, reviewer, or others for issue links, tickets, documentation, etc',
    ],
    title: '__SHORT_LABEL__ Title: "__TITLE__"',
    template: 'TEMPLATE TO FILL:\n__TEMPLATE__',
  },
};

const labelMap: Record<PromptType, { long: string; short: string }> = {
  mr: { long: 'Merge Request', short: 'MR' },
  pr: { long: 'Pull Request', short: 'PR' },
};

export function buildSystemMessage(type: PromptType, lang: Lang): string {
  const t = translations[lang];
  const label = labelMap[type].long;
  return t.system.replace('__LABEL__', label);
}

export function getSectionsFromTemplate(templateStr: string): { aiSections: Section[]; humanSections: Section[] } {
  return {
    aiSections: AI_SECTIONS.filter(s => templateStr.includes(`<!-- SECTION:${s} -->`)),
    humanSections: HUMAN_SECTIONS.filter(s => templateStr.includes(`<!-- SECTION:${s} -->`)),
  };
}

function buildPromptText(
  type: PromptType,
  lang: Lang,
  title: string,
  template: string,
  aiSections: Section[] = AI_SECTIONS,
  humanSections: Section[] = HUMAN_SECTIONS,
): string {
  const t = translations[lang];
  const short = labelMap[type].short;
  const aiSectionLabels = formatSectionList(aiSections, lang);
  const humanSectionLabels = formatSectionList(humanSections, lang);
  const instructions = t.instructions.map((i) =>
    i
      .replace('__AI_SECTIONS__', aiSectionLabels)
      .replace('__HUMAN_SECTIONS__', humanSectionLabels)
  );
  const lines = [
    t.task.replace('__SHORT_LABEL__', short),
    '',
    t.rules,
    ...instructions.map((i) => `- ${i}`),
    '',
    t.title.replace('__SHORT_LABEL__', short).replace('__TITLE__', title),
    '',
    t.template.replace('__TEMPLATE__', template),
  ];
  return lines.join('\n');
}

export function buildUserPrompt(
  type: PromptType,
  title: string,
  template: string,
  lang: Lang,
  aiSections?: Section[],
  humanSections?: Section[],
): string {
  return buildPromptText(type, lang, title, template, aiSections, humanSections);
}

export function buildPromptScriptTemplate(
  type: PromptType,
  lang: Lang,
  aiSections?: Section[],
  humanSections?: Section[],
): string {
  return buildPromptText(type, lang, '${title}', '${template}', aiSections, humanSections);
}
