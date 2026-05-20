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

export class AnthropicProvider implements AIProviderInterface {
  private apiKey: string;
  private model: string;
  private maxTokens: number;

  constructor(apiKey: string, model: string = 'claude-3-5-sonnet-20241022', maxTokens: number = MAX_TOKENS) {
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
  }

  async generate(prompt: string, diff: string, systemMessage?: string): Promise<string> {
    const response = await withRetry(() => axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: this.model,
        max_tokens: this.maxTokens,
        system: systemMessage || 'You are an AI assistant that helps developers automatically fill in Merge Request descriptions.',
        messages: [
          { role: 'user', content: `${prompt}\n\nGIT DIFF:\n${diff}` }
        ],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
      }
    ));

    return response.data.content[0]?.text?.trim() || '';
  }
}