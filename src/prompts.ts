export type Lang = 'id' | 'en';
export type PromptType = 'mr' | 'pr';

const translations: Record<Lang, {
  system: string;
  task: string;
  rules: string;
  instructions: [string, string, string, string, string, string];
  title: string;
  template: string;
}> = {
  id: {
    system: 'Kamu adalah asisten yang membantu developer mengisi deskripsi __LABEL__ secara otomatis.',
    task: 'Tugasmu adalah menganalisis git diff berikut dan mengisi template __SHORT_LABEL__ dengan tepat.',
    rules: 'Aturan:',
    instructions: [
      'Gunakan bahasa Indonesia',
      'Isi setiap section berdasarkan perubahan nyata di diff',
      'Jika tidak ada perubahan untuk suatu section, tulis hanya tanda "-"',
      'Untuk section Testing, tambahkan checklist spesifik berdasarkan perubahan',
      'Untuk section AI Review, berikan analisis teknis: ringkasan perubahan, potensi risiko, dan saran improvement',
      'Kembalikan HANYA template yang sudah diisi, tanpa penjelasan tambahan',
    ],
    title: 'Judul __SHORT_LABEL__: "__TITLE__"',
    template: 'TEMPLATE YANG HARUS DIISI:\n__TEMPLATE__',
  },
  en: {
    system: 'You are an assistant that helps developers fill __LABEL__ descriptions automatically.',
    task: 'Your task is to analyze the following git diff and fill the __SHORT_LABEL__ template correctly.',
    rules: 'Rules:',
    instructions: [
      'Use English',
      'Fill each section based on actual changes in the diff',
      'If no changes for a section, write only "-"',
      'For Testing section, add specific checklist based on changes',
      'For AI Review section, provide technical analysis: change summary, potential risks, and improvement suggestions',
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

function buildPromptText(type: PromptType, lang: Lang, title: string, template: string): string {
  const t = translations[lang];
  const short = labelMap[type].short;
  const lines = [
    t.task.replace('__SHORT_LABEL__', short),
    '',
    t.rules,
    ...t.instructions.map((i) => `- ${i}`),
    '',
    t.title.replace('__SHORT_LABEL__', short).replace('__TITLE__', title),
    '',
    t.template.replace('__TEMPLATE__', template),
  ];
  return lines.join('\n');
}

export function buildUserPrompt(type: PromptType, title: string, template: string, lang: Lang): string {
  return buildPromptText(type, lang, title, template);
}

export function buildPromptScriptTemplate(type: PromptType, lang: Lang): string {
  return buildPromptText(type, lang, '${title}', '${template}');
}
