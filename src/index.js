import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { ingestNews } from './ingest.js';
import { generatePost } from './generate.js';
import { validatePost } from './validate.js';
import { logger } from './logger.js';

const log = logger.child({ stage: 'pipeline' });

const MAX_ATTEMPTS = 3;
const STATE_FILE = 'state/published-log.json';
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'output';

/**
 * Load pipeline state (used keywords, recent titles).
 */
function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { posts: [], usedKeywords: [], lastRun: null };
  }
}

/**
 * Save updated pipeline state.
 */
function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function main() {
  log.info({ timestamp: new Date().toISOString() }, 'Pipeline started');

  // Load state
  const state = loadState();
  const recentTitles = state.posts.slice(-10).map(p => p.title);

  log.info({ usedKeywords: state.usedKeywords.length, recentPosts: recentTitles.length }, 'State loaded');

  // --- Ingest RSS news ---
  const articles = await ingestNews();
  log.info({ count: articles.length }, 'Total articles fetched');

  // --- Generate + validate with retry loop ---
  let bestPost = null;
  let passed = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const post = await generatePost(articles, state.usedKeywords, recentTitles);
      bestPost = post;

      const wordCount = post.content.split(/\s+/).length;
      log.info({
        title: post.title,
        keyword: post.keyword,
        category: post.category,
        wordCount,
        slug: post.slug,
        attempt,
      }, 'Post generated');

      const validation = validatePost(post);

      if (validation.pass) {
        log.info({ attempt }, 'Post passed all quality gates');
        passed = true;
        break;
      }

      log.warn({ failures: validation.failures, attempt }, 'Post failed quality gates');
    } catch (err) {
      log.warn({ error: err.message, attempt }, 'Generation attempt failed');
    }

    if (attempt < MAX_ATTEMPTS) {
      log.info('Retrying generation...');
    }
  }

  if (!bestPost) {
    throw new Error('All generation attempts failed -- no post could be produced');
  }

  if (!passed) {
    log.warn('All attempts failed quality gates -- publishing anyway (reliability mode)');
  }

  // --- Write post to output directory ---
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const today = new Date().toISOString().split('T')[0];
  const filename = `${today}-${bestPost.slug}.md`;
  const outputPath = `${OUTPUT_DIR}/${filename}`;

  // Clean up content -- remove markdown code fences if Gemini wrapped the output
  let content = bestPost.content;
  if (content.startsWith('```')) {
    content = content.replace(/^```(?:markdown|yaml|md)?\n/, '').replace(/\n```\s*$/, '');
  }

  writeFileSync(outputPath, content);
  log.info({ filename, outputPath }, 'Post written to disk');

  // --- Update state ---
  state.posts.push({
    title: bestPost.title,
    slug: bestPost.slug,
    keyword: bestPost.keyword,
    category: bestPost.category,
    date: today,
    filename,
  });
  state.usedKeywords.push(bestPost.keyword);
  state.lastRun = new Date().toISOString();

  saveState(state);
  log.info({ keyword: bestPost.keyword, totalPosts: state.posts.length }, 'State updated');

  // --- Write metadata for GitHub Actions ---
  // The workflow reads these environment outputs to know which file to commit
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `filename=${filename}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `title=${bestPost.title}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `slug=${bestPost.slug}\n`);
  }

  log.info({ title: bestPost.title, filename }, 'Pipeline complete');
}

main().catch((err) => {
  log.error({ error: err.message }, 'Pipeline failed');
  process.exit(1);
});
