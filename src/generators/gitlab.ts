import axios from 'axios';
import type { MRInfo, DiffFile, AIProviderInterface, Language, Section } from '../types.js';
import { HUMAN_SECTIONS } from '../types.js';
import { buildUserPrompt, buildSystemMessage } from '../prompts.js';
import { splitSections, wrapInMarkers } from '../templates/default.js';

export class GitLabGenerator {
  private token: string;
  private projectId: string;
  private mrIid: string;
  private baseUrl: string;
  private aiProvider: AIProviderInterface;
  private template: string;
  private lang: Language;
  private sections: Section[];
  private autoUpdate: boolean;

  constructor(
    token: string,
    projectId: string,
    mrIid: string,
    baseUrl: string = 'https://gitlab.com/api/v4',
    aiProvider: AIProviderInterface,
    template: string,
    lang: Language = 'id',
    sections: Section[] = ['summary', 'changes', 'testing', 'review', 'notes', 'references'],
    autoUpdate: boolean = true,
  ) {
    this.token = token;
    this.projectId = projectId;
    this.mrIid = mrIid;
    this.baseUrl = baseUrl;
    this.aiProvider = aiProvider;
    this.template = template;
    this.lang = lang;
    this.sections = sections;
    this.autoUpdate = autoUpdate;
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': this.token,
    };
  }

  private getBaseUrl() {
    return `${this.baseUrl}/projects/${this.projectId}/merge_requests/${this.mrIid}`;
  }

  async getMRInfo(): Promise<MRInfo> {
    const response = await axios.get(this.getBaseUrl(), {
      headers: this.getHeaders(),
    });
    return response.data;
  }

  async getMRDiff(): Promise<string> {
    const response = await axios.get(`${this.getBaseUrl()}/diffs`, {
      headers: this.getHeaders(),
    });

    const diffs = response.data as DiffFile[];
    return diffs
      .map((f) => `--- ${f.old_path}\n+++ ${f.new_path}\n${f.diff}`)
      .join('\n\n');
  }

  async updateMRDescription(description: string): Promise<void> {
    await axios.put(
      this.getBaseUrl(),
      { description },
      { headers: this.getHeaders() }
    );
  }

  private preserveHumanSections(newDesc: string, existingDesc: string): string {
    const newSections = splitSections(newDesc);
    const existingSections = splitSections(existingDesc);

    for (const section of this.sections) {
      if (HUMAN_SECTIONS.includes(section) && existingSections[section]) {
        newSections[section] = existingSections[section];
      }
    }

    return this.sections.map(s => {
      const content = newSections[s];
      return content
        ? `<!-- SECTION:${s} -->\n${content}\n<!-- ENDSECTION:${s} -->`
        : `<!-- SECTION:${s} -->\n-<!-- ENDSECTION:${s} -->`;
    }).join('\n\n');
  }

  async generate(): Promise<void> {
    const mrInfo = await this.getMRInfo();
    const hasDescription = mrInfo.description?.trim().length > 0;

    if (hasDescription && !this.autoUpdate) {
      console.log('[MR Generator] Deskripsi MR sudah ada, autoUpdate=false, dilewati.');
      return;
    }

    const diff = await this.getMRDiff();
    if (!diff.trim()) {
      console.log('[MR Generator] Tidak ada diff, dilewati.');
      return;
    }

    const prompt = buildUserPrompt('mr', mrInfo.title, this.template, this.lang);
    const systemMessage = buildSystemMessage('mr', this.lang);
    const description = await this.aiProvider.generate(prompt, diff, systemMessage);
    const wrapped = wrapInMarkers(description, this.sections);

    const finalDescription = hasDescription
      ? this.preserveHumanSections(wrapped, mrInfo.description)
      : wrapped;

    await this.updateMRDescription(finalDescription);

    console.log(`[MR Generator] ✓ Deskripsi MR berhasil diupdate!`);
    console.log(`[MR Generator] MR: ${mrInfo.web_url}`);
  }
}
