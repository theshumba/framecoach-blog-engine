import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'fs';
import { logger } from './logger.js';

const log = logger.child({ stage: 'generate' });

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const RATE_LIMIT_DELAY = 7000; // 7s between calls for free tier rate limits

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Loads brand voice guide from config.
 */
function loadBrandVoice() {
  return readFileSync('config/brand-voice.md', 'utf-8');
}

/**
 * Loads keyword bank and picks the next unused keyword.
 * Falls back to random selection if all keywords have been used.
 */
function selectKeyword(usedKeywords) {
  const { keywords } = JSON.parse(readFileSync('config/keywords.json', 'utf-8'));
  const available = keywords.filter(kw => !usedKeywords.includes(kw));

  if (available.length === 0) {
    log.warn('All keywords used -- resetting rotation');
    // Pick a random one from the full list
    return keywords[Math.floor(Math.random() * keywords.length)];
  }

  // Pick the next keyword in order (sequential rotation)
  return available[0];
}

/**
 * Step 1: Topic selection -- pick a topic based on RSS news + target keyword.
 */
async function selectTopic(articles, keyword, recentTitles) {
  const articleSummaries = articles.slice(0, 30).map((a, i) =>
    `[${i}] "${a.title}" (${a.sourceName}) -- ${a.contentSnippet?.slice(0, 120) || 'no summary'}`
  ).join('\n');

  const prompt = `You are a topic selector for a filmmaking blog. Your job is to pick one compelling blog post topic.

TARGET SEO KEYWORD: "${keyword}"

RECENT NEWS ARTICLES:
${articleSummaries}

RECENTLY PUBLISHED TITLES (avoid similar topics):
${recentTitles.length > 0 ? recentTitles.map(t => `- ${t}`).join('\n') : '(none yet)'}

INSTRUCTIONS:
1. Pick a topic that naturally targets the SEO keyword "${keyword}"
2. The topic should be informed by current news/trends if possible, but the post is an evergreen guide -- not a news article
3. Avoid topics too similar to recently published titles
4. The topic should be practical and actionable for filmmakers

Return JSON with these fields:
- topic: The blog post topic/title (string)
- slug: URL-friendly slug (string, lowercase-hyphenated)
- category: One of: camera-settings, composition, lighting, gear, filmmaking-tips, cinematography, post-production, indie-filmmaking, smartphone-filmmaking
- reasoning: Why this topic works (string, 1-2 sentences)
- relevantArticleIndices: Array of article indices [0-29] that inspired this topic (array of numbers)`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          slug: { type: 'string' },
          category: { type: 'string' },
          reasoning: { type: 'string' },
          relevantArticleIndices: { type: 'array', items: { type: 'integer' } },
        },
        required: ['topic', 'slug', 'category', 'reasoning', 'relevantArticleIndices'],
      },
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  try {
    return JSON.parse(response.text);
  } catch (err) {
    log.error({ error: err.message, raw: response.text?.slice(0, 500) }, 'Failed to parse topic selection JSON');
    throw new Error(`Topic selection JSON parse failed: ${err.message}`);
  }
}

/**
 * Step 2: Write the full blog post with Jekyll front matter.
 */
async function writeArticle(selection, keyword, relevantArticles) {
  const brandVoice = loadBrandVoice();
  const today = new Date().toISOString().split('T')[0];

  const newsContext = relevantArticles.map(a =>
    `- "${a.title}" (${a.sourceName}): ${a.contentSnippet?.slice(0, 200) || 'no details'}`
  ).join('\n');

  const systemInstruction = `You are a filmmaker who writes practical blog posts for the FrameCoach blog. Follow this brand voice guide exactly:

${brandVoice}`;

  const prompt = `Write a complete blog post for the FrameCoach filmmaking blog.

TOPIC: ${selection.topic}
TARGET SEO KEYWORD: "${keyword}"
CATEGORY: ${selection.category}
DATE: ${today}

RELEVANT NEWS (use for context/inspiration, not as the main focus):
${newsContext}

REQUIREMENTS:
1. Start with Jekyll front matter in this exact format:
---
layout: post
title: "${selection.topic}"
description: "[Write a compelling meta description under 155 characters targeting '${keyword}']"
date: ${today}
categories: [${selection.category}]
tags: [${keyword}, tag2, tag3, tag4]
---

2. Write 1500-2000 words of practical, actionable content
3. Use H2 headings (##) to break into 4-6 sections
4. Mention FrameCoach naturally 2-3 times with a link to https://framecoach.io
5. Include the target keyword "${keyword}" naturally in the first paragraph and 3-4 more times throughout
6. Write like a working filmmaker, not an AI -- use specific f-stops, shutter speeds, real camera models, real film references
7. Include at least one practical tip that readers can use on their next shoot
8. Do NOT use these phrases: "in today's rapidly evolving landscape", "delve into", "game-changer", "paradigm shift", "embark on a journey", "the realm of", "it's important to note", "whether you're a beginner or professional"
9. Do NOT start the post with a question
10. End with a practical next step, not a summary

Write the complete post now, starting with the --- front matter.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const content = response.text;

  // Extract title from front matter
  const titleMatch = content.match(/title:\s*"([^"]+)"/);
  const title = titleMatch ? titleMatch[1] : selection.topic;

  return {
    title,
    slug: selection.slug,
    content,
    category: selection.category,
  };
}

/**
 * Main generation pipeline: topic selection + article writing.
 */
export async function generatePost(articles, usedKeywords, recentTitles) {
  // Pick the next keyword in rotation
  const keyword = selectKeyword(usedKeywords);
  log.info({ keyword }, 'Selected target keyword');

  // Step 1: Topic selection
  log.info('Step 1: Selecting topic...');
  const selection = await selectTopic(articles, keyword, recentTitles);
  log.info({ topic: selection.topic, slug: selection.slug, category: selection.category }, 'Topic selected');

  // Map article indices to actual articles
  const relevantArticles = (selection.relevantArticleIndices || [])
    .filter(i => i >= 0 && i < articles.length)
    .map(i => articles[i]);

  if (relevantArticles.length === 0) {
    relevantArticles.push(...articles.slice(0, 3));
  }

  // Step 2: Write article
  await delay(RATE_LIMIT_DELAY);
  log.info('Step 2: Writing article...');
  const article = await writeArticle(selection, keyword, relevantArticles);

  const wordCount = article.content.split(/\s+/).length;
  log.info({ title: article.title, wordCount, keyword }, 'Article generated');

  return {
    ...article,
    keyword,
    date: new Date().toISOString(),
    reasoning: selection.reasoning,
    sources: relevantArticles,
  };
}
