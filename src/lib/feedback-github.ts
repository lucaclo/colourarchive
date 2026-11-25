/**
 * The published site's way to send feedback (lib/feedback.ts): it has no
 * server, so the page files an issue in the private feedback repo itself,
 * with a fine-grained token kept on the device (Contents and Issues, write,
 * on that one repo). Each picture is committed to `shots/` first and the
 * issue links it; `npm run feedback` downloads them again.
 *
 * `fetch` is passed in, so tests answer for GitHub.
 */
import { issueBody, issueTitle, type FeedbackContext, type ImageExt } from './feedback';

export interface GitHubTarget {
  token: string;
  repo: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(
    message: string,
    /** Whether the token itself is the problem: the sheet asks for a new one. */
    readonly badToken = false,
  ) {
    super(message);
  }
}

const headers = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'content-type': 'application/json',
});

/** A reply that isn't a success, as one short reason. */
function failure(res: Response): GitHubError {
  const { status } = res;
  // GitHub answers 403 for a rate limit too: that one keeps the token (it's shown only once).
  if (status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after'))) {
    return new GitHubError('GitHub asked to wait a minute');
  }
  if (status === 401) return new GitHubError('GitHub didn’t accept the token', true);
  if (status === 403 || status === 404) return new GitHubError('The token can’t reach the feedback repo', true);
  if (status === 422) return new GitHubError('GitHub refused the picture');
  return new GitHubError(`GitHub answered ${status}`);
}

async function call(fetchFn: Fetch, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch {
    throw new GitHubError('No connection to GitHub');
  }
  if (!res.ok) throw failure(res);
  return res;
}

/** Whether the token can see the repo; throws a GitHubError saying why not. */
export async function checkToken(target: GitHubTarget, fetchFn: Fetch = fetch): Promise<void> {
  await call(fetchFn, `${API}/repos/${target.repo}`, { headers: headers(target.token), cache: 'no-store' });
}

/** Bytes as base64, in chunks small enough for String.fromCharCode. */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface Outgoing {
  id: string;
  note: string;
  created: string;
  context: FeedbackContext;
  images: { ext: ImageExt; bytes: Uint8Array }[];
}

/** Commit the pictures, then file the issue. Its number and address. */
export async function fileIssue(target: GitHubTarget, item: Outgoing, fetchFn: Fetch = fetch): Promise<{ number: number; url: string }> {
  const urls: string[] = [];
  for (const [i, img] of item.images.entries()) {
    const name = `${item.id}-${i + 1}.${img.ext}`;
    await call(fetchFn, `${API}/repos/${target.repo}/contents/shots/${name}`, {
      method: 'PUT',
      headers: headers(target.token),
      body: JSON.stringify({ message: `Picture for ${item.id}`, content: toBase64(img.bytes) }),
    });
    // The blob address shows in the issue for anyone signed in with access; ?raw=true makes it the picture.
    urls.push(`https://github.com/${target.repo}/blob/HEAD/shots/${name}?raw=true`);
  }
  const res = await call(fetchFn, `${API}/repos/${target.repo}/issues`, {
    method: 'POST',
    headers: headers(target.token),
    body: JSON.stringify({
      title: issueTitle(item.note, item.context.page),
      body: issueBody({ id: item.id, note: item.note, created: item.created, ...item.context }, urls),
    }),
  });
  const issue = (await res.json().catch(() => ({}))) as { number?: number; html_url?: string };
  return { number: Number(issue.number), url: String(issue.html_url ?? '') };
}
