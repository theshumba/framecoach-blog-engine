import Parser from 'rss-parser';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { logger } from './logger.js';

const log = logger.child({ stage: 'ingest' });

export async function ingestNews() {
  const config = JSON.parse(readFileSync('config/feeds.json', 'utf-8'));
  const { feeds, globalKeywords = [], excludeKeywords = [], maxArticleAgeDays = 7, minArticlesRequired = 3 } = config;

  log.info({ feedCount: feeds.length }, 'Starting RSS ingestion');

  const parser = new Parser({
    timeout: 10000,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'FrameCoachBlogEngine/1.0',
    },
  });

  // --- Stage 1: Fetch all feeds ---
  const results = await Promise.allSettled(
    feeds.map(feed => parser.parseURL(feed.url))
  );

  const allArticles = [];
  let succeeded = 0;
  let failed = 0;

  for (const [i, result] of results.entries()) {
    const feed = feeds[i];
    if (result.status === 'fulfilled') {
      const items = result.value.items.map(item => ({
        title: item.title,
        link: item.link,
        pubDate: item.isoDate || item.pubDate,
        contentSnippet: item.contentSnippet || '',
        source: feed.id,
        sourceName: feed.name,
      }));
      log.info({ feed: feed.id, items: items.length }, 'Feed fetched');
      allArticles.push(...items);
      succeeded++;
    } else {
      log.warn({ feed: feed.id, error: result.reason?.message }, 'Feed failed -- skipping');
      failed++;
    }
  }

  log.info({ totalArticles: allArticles.length, feedsSucceeded: succeeded, feedsFailed: failed }, 'Fetch complete');

  // --- Stage 2: Freshness filter ---
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxArticleAgeDays);

  const fresh = allArticles.filter(article => {
    if (!article.pubDate) return false;
    const parsed = new Date(article.pubDate);
    if (isNaN(parsed.getTime())) return false;
    return parsed >= cutoff;
  });

  log.info({ before: allArticles.length, after: fresh.length }, 'Freshness filter applied');

  // --- Stage 3: Exclude irrelevant content ---
  const filtered = fresh.filter(article => {
    const text = `${article.title || ''} ${article.contentSnippet || ''}`.toLowerCase();
    return !excludeKeywords.some(kw => text.includes(kw.toLowerCase()));
  });

  log.info({ before: fresh.length, after: filtered.length }, 'Exclusion filter applied');

  // --- Stage 4: Keyword relevance filter ---
  const feedMap = Object.fromEntries(feeds.map(f => [f.id, f]));

  const relevant = filtered.filter(article => {
    const feedConfig = feedMap[article.source];
    const feedKeywords = feedConfig?.keywords || [];

    // Google News feeds have empty keywords -- articles are pre-filtered by search query
    if (feedKeywords.length === 0) return true;

    const allKeywords = [...feedKeywords, ...globalKeywords];
    const text = `${article.title || ''} ${article.contentSnippet || ''}`.toLowerCase();
    return allKeywords.some(kw => text.includes(kw.toLowerCase()));
  });

  log.info({ before: filtered.length, after: relevant.length }, 'Keyword filter applied');

  // --- Stage 5: Content-hash deduplication ---
  const seen = new Set();
  const unique = relevant.filter(article => {
    const normalized = `${(article.title || '').toLowerCase().trim()}|${article.link}`;
    const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });

  log.info({ before: relevant.length, after: unique.length, duplicatesRemoved: relevant.length - unique.length }, 'Deduplication applied');

  // --- Stage 6: Minimum article threshold ---
  if (unique.length < minArticlesRequired) {
    const msg = `Only ${unique.length} articles found, need at least ${minArticlesRequired}`;
    log.error({ found: unique.length, required: minArticlesRequired }, msg);
    throw new Error(msg);
  }

  log.info({ totalArticles: unique.length }, 'Ingestion complete');
  return unique;
}
