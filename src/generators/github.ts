import axios from 'axios';
import type { PRInfo, AIProviderInterface, Language, Section } from '../types.js';
import { HUMAN_SECTIONS } from '../types.js';
import { buildUserPrompt, buildSystemMessage } from '../prompts.js';
import { splitSections, wrapInMarkers } from '../templates/default.js';

interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export class GitHubGenerator {
  private token: string;
  private owner: string;
  private repo: string;
  private prNumber: string;
  private baseUrl: string;
  private aiProvider: AIProviderInterface;
  private template: string;
  private lang: Language;
  private sections: Section[];
  private autoUpdate: boolean;

  constructor(
    token: string,
    owner: string,
    repo: string,
    prNumber: string,
    baseUrl: string = 'https://api.github.com',
    aiProvider: AIProviderInterface,
    template: string,
    lang: Language = 'id',
    sections: Section[] = ['summary', 'changes', 'testing', 'review', 'notes', 'references'],
    autoUpdate: boolean = true,
  ) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.prNumber = prNumber;
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
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
    };
  }

  private getBaseUrl() {
    return `${this.baseUrl}/repos/${this.owner}/${this.repo}`;
  }

  async getPRInfo(): Promise<PRInfo> {
    const response = await axios.get(`${this.getBaseUrl()}/pulls/${this.prNumber}`, {
      headers: this.getHeaders(),
    });
    return response.data;
  }

  async getPRDiff(): Promise<string> {
    const response = await axios.get(`${this.getBaseUrl()}/pulls/${this.prNumber}/files`, {
      headers: this.getHeaders(),
    });

    const files = response.data as PRFile[];
    return files
      .map((f) => {
        if (!f.patch) return '';
        return `--- ${f.filename}\n+++ ${f.filename}\n${f.patch}`;
      })
      .filter(Boolean)
      .join('\n\n');
  }

  async updatePRDescription(description: string): Promise<void> {
    await axios.patch(
      `${this.getBaseUrl}/pulls/${this.prNumber}`,
      { body: description },
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
    const prInfo = await this.getPRInfo();
    const hasDescription = prInfo.body?.trim().length > 0;

    if (hasDescription && !this.autoUpdate) {
      console.log('[PR Generator] Deskripsi PR sudah ada, autoUpdate=false, dilewati.');
      return;
    }

    const diff = await this.getPRDiff();
    if (!diff.trim()) {
      console.log('[PR Generator] Tidak ada diff, dilewati.');
      return;
    }

    const prompt = buildUserPrompt('pr', prInfo.title, this.template, this.lang);
    const systemMessage = buildSystemMessage('pr', this.lang);
    const description = await this.aiProvider.generate(prompt, diff, systemMessage);
    const wrapped = wrapInMarkers(description, this.sections);

    const finalDescription = hasDescription
      ? this.preserveHumanSections(wrapped, prInfo.body)
      : wrapped;

    await this.updatePRDescription(finalDescription);

    console.log(`[PR Generator] ✓ Deskripsi PR berhasil diupdate!`);
    console.log(`[PR Generator] PR: ${prInfo.html_url}`);
  }
}
