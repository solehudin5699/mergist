import axios from 'axios';
import type { MRInfo, DiffFile, AIProviderInterface } from '../types.js';

export class GitLabGenerator {
  private token: string;
  private projectId: string;
  private mrIid: string;
  private baseUrl: string;
  private aiProvider: AIProviderInterface;
  private template: string;

  constructor(
    token: string,
    projectId: string,
    mrIid: string,
    baseUrl: string = 'https://gitlab.com/api/v4',
    aiProvider: AIProviderInterface,
    template: string
  ) {
    this.token = token;
    this.projectId = projectId;
    this.mrIid = mrIid;
    this.baseUrl = baseUrl;
    this.aiProvider = aiProvider;
    this.template = template;
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

  async generate(): Promise<void> {
    const mrInfo = await this.getMRInfo();

    if (mrInfo.description && mrInfo.description.trim().length > 0) {
      console.log('[MR Generator] Deskripsi MR sudah diisi, dilewati.');
      return;
    }

    const diff = await this.getMRDiff();
    if (!diff.trim()) {
      console.log('[MR Generator] Tidak ada diff, dilewati.');
      return;
    }

    const prompt = `Kamu adalah asisten yang membantu developer mengisi deskripsi Merge Request secara otomatis.

Tugasmu adalah menganalisis git diff berikut dan mengisi template MR dengan tepat.

Aturan:
- Gunakan bahasa Indonesia
- Isi setiap section berdasarkan perubahan nyata di diff
- Jika tidak ada perubahan untuk suatu section, tulis hanya tanda "-"
- Untuk section Testing, tambahkan checklist spesifik berdasarkan perubahan
- Kembalikan HANYA template yang sudah diisi, tanpa penjelasan tambahan

Judul MR: "${mrInfo.title}"

TEMPLATE YANG HARUS DIISI:
${this.template}`;

    const description = await this.aiProvider.generate(prompt, diff);
    await this.updateMRDescription(description);

    console.log(`[MR Generator] ✓ Deskripsi MR berhasil diupdate!`);
    console.log(`[MR Generator] MR: ${mrInfo.web_url}`);
  }
}