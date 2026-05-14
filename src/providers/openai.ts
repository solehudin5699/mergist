import axios from 'axios';
import type { AIProviderInterface } from '../types.js';

export class OpenAIProvider implements AIProviderInterface {
  private apiKey: string;
  private model: string;
  private maxTokens: number = 1000;

  constructor(apiKey: string, model: string = 'gpt-4o') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(prompt: string, diff: string, systemMessage?: string): Promise<string> {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [
          {
            role: 'system',
            content: systemMessage || 'Kamu adalah asisten yang membantu developer mengisi deskripsi Merge Request secara otomatis.',
          },
          {
            role: 'user',
            content: `${prompt}\n\nGIT DIFF:\n${diff}`,
          },
        ],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
      }
    );

    return response.data.choices[0]?.message?.content?.trim() || '';
  }
}