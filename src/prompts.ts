import { AI_SECTIONS, HUMAN_SECTIONS, type Section } from './types.js';

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
  instructions: [string, string, string, string, string, string, string];
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
      'Jika tidak ada perubahan untuk suatu section, tulis hanya tanda "-"',
      'Untuk section Testing, tambahkan checklist spesifik berdasarkan perubahan',
      'Untuk section AI Review, berikan analisis teknis dengan format berikut:\n- 🔴 **High**: Masalah keamanan, hardcoded secrets, critical bugs (sertakan file:line)\n- 🟡 **Medium**: Code smells, error handling, performance concerns (sertakan file:line)\n- 🟢 **Info**: Best practices, naming suggestions, minor improvements',
      'Hanya isi section __AI_SECTIONS__. Biarkan __HUMAN_SECTIONS__ apa adanya',
      'Kembalikan HANYA template yang sudah diisi, tanpa penjelasan tambahan',
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
      'If no changes for a section, write only "-"',
      'For Testing section, add specific checklist based on changes',
      'For AI Review section, provide technical analysis with the following format:\n- 🔴 **High**: Security issues, hardcoded secrets, critical bugs (include file:line)\n- 🟡 **Medium**: Code smells, error handling, performance concerns (include file:line)\n- 🟢 **Info**: Best practices, naming suggestions, minor improvements',
      'Only fill sections: __AI_SECTIONS__. Leave __HUMAN_SECTIONS__ as-is',
      'Return ONLY the filled template, without additional explanation',
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
