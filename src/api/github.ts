import axios from 'axios';
import { USER_AGENT } from '../constants.js';

export function parseGitHubRemote(remoteUrl: string): { owner: string; repo: string } {
  const normalized = remoteUrl.replace(/\.git$/, '');

  const sshMatch = normalized.match(/^git@github\.com:(.+?)\/(.+?)$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  const httpsMatch = normalized.match(/^https:\/\/github\.com\/(.+?)\/(.+?)$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  const gitMatch = normalized.match(/^git:\/\/github\.com\/(.+?)\/(.+?)$/);
  if (gitMatch) return { owner: gitMatch[1], repo: gitMatch[2] };

  throw new Error(`Unrecognized GitHub remote URL: ${remoteUrl}`);
}

export async function createPR(
  token: string,
  owner: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body: string,
): Promise<{ html_url: string }> {
  const response = await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      head,
      base,
      title,
      body,
      draft: true,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': USER_AGENT,
      },
    },
  );
  return response.data;
}
