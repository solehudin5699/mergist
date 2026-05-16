import type { Section, Language } from '../types.js';
import type { PromptType } from '../prompts.js';

type Lang = Language;
type RenderFn = (lang: Lang, type: PromptType) => string;

function renderSub(lang: Lang, sub: 'features' | 'fixes' | 'removals'): string {
  const labels: Record<string, Record<Lang, string>> = {
    features: { id: '### Fitur Baru', en: '### Features' },
    fixes: { id: '### Perbaikan & Perubahan', en: '### Fixes & Changes' },
    removals: { id: '### Yang Dihapus', en: '### Removals' },
  };
  return `${labels[sub][lang]}\n-`;
}

const sectionRenderers: Record<Section, RenderFn> = {
  summary: (lang, type) => {
    const headings: Record<Lang, string> = { id: '## Ringkasan', en: '## Summary' };
    const label = type === 'mr' ? 'MR' : 'PR';
    const comments: Record<Lang, string> = {
      id: `<!-- Ringkasan singkat tujuan ${label} ini -->`,
      en: `<!-- Brief description of this ${label}'s purpose -->`,
    };
    return `${headings[lang]}\n${comments[lang]}\n-`;
  },
  changes: (lang, type) => {
    const headings: Record<Lang, string> = { id: '## Daftar Perubahan', en: '## Changes' };
    return [headings[lang], '', renderSub(lang, 'features'), renderSub(lang, 'fixes'), renderSub(lang, 'removals')].join('\n');
  },
  testing: (lang, type) => {
    return lang === 'id'
      ? '## Testing\n- [ ] Sudah ditest secara lokal\n- [ ] Tidak ada breaking change'
      : '## Testing\n- [ ] Tested locally\n- [ ] No breaking changes';
  },
  review: () => '## AI Review\n\n### 🔴 High\n-\n\n### 🟡 Medium\n-\n\n### 🟢 Info\n-',
  notes: (lang) => lang === 'id' ? '## Catatan\n-' : '## Notes\n-',
  references: (lang) => lang === 'id' ? '## Referensi\nCloses #' : '## References\nCloses #',
};

export function buildTemplate(type: PromptType, sections: Section[], lang: Lang): string {
  return sections.map(s => {
    const content = sectionRenderers[s](lang, type);
    return `<!-- SECTION:${s} -->\n${content}\n<!-- ENDSECTION:${s} -->`;
  }).join('\n\n');
}

const SECTION_RE = /<!-- SECTION:(\w+) -->\n?([\s\S]*?)\n?<!-- ENDSECTION:\1 -->/g;

export function splitSections(description: string): Record<string, string> {
  const sections: Record<string, string> = {};
  let match;
  while ((match = SECTION_RE.exec(description)) !== null) {
    sections[match[1]] = match[2].trim();
  }
  return sections;
}

const SECTION_HEADINGS: Record<Section, string[]> = {
  summary: ['## Ringkasan', '## Summary'],
  changes: ['## Daftar Perubahan', '## Changes'],
  testing: ['## Testing'],
  review: ['## AI Review'],
  notes: ['## Catatan', '## Notes'],
  references: ['## Referensi', '## References'],
};

export function wrapInMarkers(text: string, sections: Section[]): string {
  if (text.includes('<!-- SECTION:')) {
    const existing = splitSections(text);
    return sections.map(s =>
      `<!-- SECTION:${s} -->\n${existing[s] ?? '-'}\n<!-- ENDSECTION:${s} -->`
    ).join('\n\n');
  }

  const parts: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const heading = SECTION_HEADINGS[s].find(h => text.includes(h));
    if (!heading) {
      parts.push(`<!-- SECTION:${s} -->\n-\n<!-- ENDSECTION:${s} -->`);
      continue;
    }

    const headingIdx = text.indexOf(heading);
    const afterHeading = text.slice(headingIdx + heading.length);
    const nextSections = sections.slice(i + 1);
    const nextHeading = nextSections
      .map(s2 => SECTION_HEADINGS[s2].find(h => afterHeading.includes(h)))
      .find(Boolean);

    const content = nextHeading
      ? afterHeading.slice(0, afterHeading.indexOf(nextHeading)).trim()
      : afterHeading.trim();

    parts.push(`<!-- SECTION:${s} -->\n${heading}\n${content || '-'}\n<!-- ENDSECTION:${s} -->`);
  }
  return parts.join('\n\n');
}
