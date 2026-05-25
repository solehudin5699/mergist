export type ParsedMrPr = 
  | { platform: 'gitlab'; projectId: string; mrNumber: string; projectPath: string; apiUrl: string }
  | { platform: 'github'; owner: string; repo: string; prNumber: string };

function stripQueryParams(url: string): string {
  const questionMarkIndex = url.indexOf('?');
  if (questionMarkIndex !== -1) {
    return url.substring(0, questionMarkIndex);
  }
  return url;
}

export function parseMrPrUrl(url: string): ParsedMrPr {
  const cleanUrl = stripQueryParams(url);
  
  const gitlab = parseGitLabUrl(cleanUrl);
  if (gitlab) return gitlab;

  const github = parseGitHubUrl(cleanUrl);
  if (github) return github;

  throw new Error('Invalid MR/PR URL. Expected: https://gitlab.com/.../merge_requests/123 or https://github.com/.../pull/123');
}

function parseGitLabUrl(url: string): ParsedMrPr | null {
  const patterns = [
    /(?:https?:\/\/)?([^\/]+)\/(.+?)\/-?\/?merge_requests\/(\d+)/,
    /^([^\/]+)\/(.+?)\/-?\/?merge_requests\/(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      const host = match[1];
      const projectPath = match[2].replace(/\.git$/, '');
      const mrNumber = match[3];
      
      const apiUrl = host === 'gitlab.com' 
        ? 'https://gitlab.com/api/v4' 
        : `https://${host}/api/v4`;
      
      return {
        platform: 'gitlab',
        projectPath,
        mrNumber,
        apiUrl,
        projectId: '', // Will be filled after API call
      };
    }
  }

  return null;
}

function parseGitHubUrl(url: string): ParsedMrPr | null {
  const patterns = [
    /(?:https?:\/\/)?github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/,
    /^github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        platform: 'github',
        owner: match[1],
        repo: match[2].replace(/\.git$/, ''),
        prNumber: match[3],
      };
    }
  }

  return null;
}

export function isValidMrPrUrl(url: string): boolean {
  try {
    parseMrPrUrl(url);
    return true;
  } catch {
    return false;
  }
}