import axios from 'axios';
import type { AIProviderInterface } from '../types.js';
import { MAX_TOKENS } from '../constants.js';

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err: any) {
      if (i < retries - 1 && err.response?.status === 429) {
        const delay = Math.pow(2, i) * 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('withRetry: max retries exceeded');
}

export class OpenAIProvider implements AIProviderInterface {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private maxTokens: number;

  constructor(apiKey: string, model: string = 'gpt-4o', baseUrl: string = 'https://api.openai.com/v1', maxTokens: number = MAX_TOKENS) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
    this.maxTokens = maxTokens;
  }

  async generate(prompt: string, diff: string, systemMessage?: string): Promise<string> {
    const response = await withRetry(() => axios.post(
      `${this.baseUrl}/chat/completions`,
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
    ));

    return response.data.choices[0]?.message?.content?.trim() || '';
  }
}