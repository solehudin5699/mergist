import axios from 'axios';
import type { PRInfo, AIProviderInterface } from '../types.js';
import { buildUserPrompt, buildSystemMessage } from '../prompts.js';

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

  constructor(
    token: string,
    owner: string,
    repo: string,
    prNumber: string,
    baseUrl: string = 'https://api.github.com',
    aiProvider: AIProviderInterface,
    template: string
  ) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.prNumber = prNumber;
    this.baseUrl = baseUrl;
    this.aiProvider = aiProvider;
    this.template = template;
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

  async generate(): Promise<void> {
    const prInfo = await this.getPRInfo();

    if (prInfo.body && prInfo.body.trim().length > 0) {
      console.log('[PR Generator] Deskripsi PR sudah diisi, dilewati.');
      return;
    }

    const diff = await this.getPRDiff();
    if (!diff.trim()) {
      console.log('[PR Generator] Tidak ada diff, dilewati.');
      return;
    }

    const prompt = buildUserPrompt('pr', prInfo.title, this.template);
    const systemMessage = buildSystemMessage('pr');

    const description = await this.aiProvider.generate(prompt, diff, systemMessage);
    await this.updatePRDescription(description);

    console.log(`[PR Generator] ✓ Deskripsi PR berhasil diupdate!`);
    console.log(`[PR Generator] PR: ${prInfo.html_url}`);
  }
}