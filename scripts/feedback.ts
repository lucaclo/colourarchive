/**
 * Feedback sent from the app (src/lib/feedback.ts), for working through it.
 *
 *   npm run feedback                   pull new issues from the private feedback
 *                                      repo, then list everything open
 *   npm run feedback -- done <id> [words]
 *                                      mark it done; an issue is closed with the
 *                                      words as its comment ("Fixed in #190")
 *   npm run feedback -- done           list the done ones
 *   npm run feedback -- --offline      skip GitHub
 *
 * Open items are folders in the archive's `.archive/feedback/` (the Mac app
 * and the published site's issues, pulled as `gh-<number>`), and in the
 * repo's own `feedback/` when the dev server kept some. Each listing names
 * the pictures by full path, so they can be opened.
 */
// The real archive (the Mac app's folder) unless COLOUR_ARCHIVE_DATA says otherwise.
import './use-real-archive.ts';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { FEEDBACK_REPO, issueImages, pageLabel, parseIssueBody, validFeedbackId } from '../src/lib/feedback.ts';
import { hasFeedback, importIssue, listFeedback, markDone, type ListedFeedback } from '../src/lib/feedback-store.ts';
import { FEEDBACK_DIR, ROOT } from '../src/lib/paths.ts';

const run = promisify(execFile);
const REPO = process.env.FEEDBACK_REPO || FEEDBACK_REPO;
const tilde = (p: string) => p.replace(os.homedir(), '~');

/** The archive's folder first (where pulled issues go), then any the dev server wrote. */
async function folders(): Promise<string[]> {
  const out = [FEEDBACK_DIR, path.join(ROOT, 'feedback')];
  try {
    // From a worktree, the main checkout's dev server keeps its own.
    const { stdout } = await run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT });
    out.push(path.join(path.dirname(stdout.trim()), 'feedback'));
  } catch {
    /* not a git checkout */
  }
  return [...new Set(out.map((p) => path.resolve(p)))];
}

interface Issue {
  number: number;
  title: string;
  body: string;
  createdAt: string;
  url: string;
}

async function gh(args: string[]): Promise<Buffer> {
  const { stdout } = await run('gh', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** New open issues in as `gh-<n>`; local copies of issues closed on GitHub marked done. */
async function pull(dir: string): Promise<void> {
  const LIMIT = 500;
  let issues: Issue[];
  try {
    const out = await gh(['issue', 'list', '-R', REPO, '--state', 'open', '--limit', String(LIMIT), '--json', 'number,title,body,createdAt,url']);
    issues = JSON.parse(out.toString('utf8'));
  } catch (err) {
    const why = err instanceof Error ? err.message.split('\n')[0] : String(err);
    console.log(`GitHub: couldn’t list ${REPO} (${why}). Showing what’s here.`);
    return;
  }
  let added = 0;
  for (const issue of issues) {
    if (await hasFeedback(dir, `gh-${issue.number}`)) continue;
    const parsed = parseIssueBody(issue.body ?? '');
    const images: Uint8Array[] = [];
    for (const name of issueImages(issue.body ?? '')) {
      try {
        images.push(await gh(['api', '-H', 'Accept: application/vnd.github.raw', `repos/${REPO}/contents/shots/${name}`]));
      } catch {
        console.log(`  #${issue.number}: couldn’t download ${name}`);
      }
    }
    await importIssue(
      dir,
      {
        number: issue.number,
        url: issue.url,
        note: parsed.note || issue.title,
        context: parsed.context,
        created: parsed.created ?? issue.createdAt,
      },
      images,
    );
    added++;
  }
  const open = new Set(issues.map((i) => `gh-${i.number}`));
  let closed = 0;
  // A full page may not be every open issue: then nothing is taken as closed.
  for (const item of issues.length < LIMIT ? await listFeedback(dir) : []) {
    if (item.source === 'github' && !open.has(item.id)) {
      await markDone(dir, item.id);
      closed++;
    }
  }
  if (added || closed) console.log(`GitHub: ${added} new, ${closed} closed there`);
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function show(item: ListedFeedback) {
  const facts = [when(item.created), item.device, `${pageLabel(item.page)} ${item.page}`, item.viewport, item.build.split(' ')[0]];
  if (item.issue) facts.push(`#${item.issue}`);
  console.log(`\n${item.id}  ${facts.filter(Boolean).join(' · ')}`);
  for (const line of (item.note || '(no note)').split('\n')) console.log(`  ${line}`);
  for (const p of item.pictures) console.log(`  picture: ${p}`);
  if (item.done) console.log(`  done ${when(item.done)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const offline = args.includes('--offline');
  const rest = args.filter((a) => a !== '--offline');
  const dirs = await folders();

  if (rest[0] === 'done' && rest[1]) {
    const id = rest[1];
    if (!validFeedbackId(id)) {
      console.error(`Not a feedback id: ${id}`);
      process.exit(1);
    }
    const words = rest.slice(2).join(' ').trim();
    for (const dir of dirs) {
      const open = (await listFeedback(dir)).find((it) => it.id === id);
      if (!open) continue;
      // The issue first: if GitHub can't close it, it stays open here too, to try again.
      if (open.issue && !offline) {
        try {
          await gh(['issue', 'close', String(open.issue), '-R', REPO, '--comment', words || 'Done']);
          console.log(`Closed #${open.issue}`);
        } catch (err) {
          console.error(`Couldn’t close #${open.issue}: ${err instanceof Error ? err.message.split('\n')[0] : err}. Still open.`);
          process.exit(1);
        }
      }
      await markDone(dir, id);
      console.log(`Done: ${id} (${tilde(path.join(dir, 'done', id))})`);
      return;
    }
    console.error(`No open feedback ${id}`);
    process.exit(1);
  }

  if (!offline) await pull(dirs[0]);
  const which = rest[0] === 'done' ? 'done' : 'open';
  const items = (await Promise.all(dirs.map((d) => listFeedback(d, which)))).flat().sort((a, b) => a.created.localeCompare(b.created));
  // The archive's folder always; a dev folder only when it has something in it.
  const shown = dirs.filter((d, i) => i === 0 || items.some((it) => it.folder.startsWith(d + path.sep)));
  console.log(`\n${which === 'done' ? 'Done' : 'Open'} feedback ${items.length}  (${shown.map(tilde).join(', ')})`);
  items.forEach(show);
  if (which === 'open' && items.length) console.log('\nWhen one is fixed: npm run feedback -- done <id> "Fixed in #…"');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
