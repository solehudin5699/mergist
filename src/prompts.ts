type PromptType = 'mr' | 'pr';

export function buildSystemMessage(type: PromptType): string {
  const label = type === 'mr' ? 'Merge Request' : 'Pull Request';
  return `Kamu adalah asisten yang membantu developer mengisi deskripsi ${label} secara otomatis.`;
}

const PROMPT_TEMPLATE = `Tugasmu adalah menganalisis git diff berikut dan mengisi template __LABEL__ dengan tepat.

Aturan:
- Gunakan bahasa Indonesia
- Isi setiap section berdasarkan perubahan nyata di diff
- Jika tidak ada perubahan untuk suatu section, tulis hanya tanda "-"
- Untuk section Testing, tambahkan checklist spesifik berdasarkan perubahan
- Kembalikan HANYA template yang sudah diisi, tanpa penjelasan tambahan

Judul __LABEL__: "__TITLE__"

TEMPLATE YANG HARUS DIISI:
__TEMPLATE__`;

export function buildUserPrompt(type: PromptType, title: string, template: string): string {
  const label = type === 'mr' ? 'MR' : 'PR';
  return PROMPT_TEMPLATE
    .replace(/__LABEL__/g, label)
    .replace('__TITLE__', title)
    .replace('__TEMPLATE__', template);
}

export { PROMPT_TEMPLATE };