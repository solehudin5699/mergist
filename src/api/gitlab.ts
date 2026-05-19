import axios from 'axios';

function getProjectPath(remoteUrl: string): string {
  const normalized = remoteUrl.replace(/\.git$/, '');

  const sshMatch = normalized.match(/^git@(.+?):(.+?)$/);
  if (sshMatch) return sshMatch[2];

  const httpsMatch = normalized.match(/^https:\/\/(.+?)\/(.+?)$/);
  if (httpsMatch) return httpsMatch[2];

  const gitMatch = normalized.match(/^git:\/\/(.+?)\/(.+?)$/);
  if (gitMatch) return gitMatch[2];

  throw new Error(`Unrecognized GitLab remote URL: ${remoteUrl}`);
}

export function getGitLabApiUrl(remoteUrl: string): string {
  const sshMatch = remoteUrl.match(/^git@(.+?):/);
  if (sshMatch) {
    const host = sshMatch[1];
    return host === 'gitlab.com' ? 'https://gitlab.com/api/v4' : `https://${host}/api/v4`;
  }

  const httpsMatch = remoteUrl.match(/^https:\/\/(.+?)\//);
  if (httpsMatch) {
    const host = httpsMatch[1];
    return host === 'gitlab.com' ? 'https://gitlab.com/api/v4' : `https://${host}/api/v4`;
  }

  const gitMatch = remoteUrl.match(/^git:\/\/(.+?)\//);
  if (gitMatch) {
    const host = gitMatch[1];
    return host === 'gitlab.com' ? 'https://gitlab.com/api/v4' : `https://${host}/api/v4`;
  }

  return 'https://gitlab.com/api/v4';
}

export async function getProjectId(token: string, apiUrl: string, remoteUrl: string): Promise<string> {
  const path = getProjectPath(remoteUrl);
  const encodedPath = encodeURIComponent(path);
  const response = await axios.get(`${apiUrl}/projects/${encodedPath}`, {
    headers: { 'PRIVATE-TOKEN': token },
  });
  return String(response.data.id);
}

export async function createMR(
  token: string,
  apiUrl: string,
  projectId: string,
  sourceBranch: string,
  targetBranch: string,
  title: string,
  description: string,
): Promise<{ web_url: string }> {
  const response = await axios.post(
    `${apiUrl}/projects/${projectId}/merge_requests`,
    {
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title: `Draft: ${title}`,
      description,
    },
    { headers: { 'Content-Type': 'application/json', 'PRIVATE-TOKEN': token } },
  );
  return response.data;
}
