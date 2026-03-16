// Quality gate validation for FrameCoach Blog Engine
// Pure functions -- no side effects, no file I/O, no logging

const FILLER_PHRASES = [
  "in today's rapidly evolving landscape",
  "in today's rapidly changing",
  "in the ever-evolving landscape",
  "in the ever-changing landscape",
  "it is important to note",
  "it's important to note",
  "it is worth noting",
  "in an increasingly interconnected world",
  "stands as a testament to",
  "serves as a beacon",
  "a beacon of hope",
  "at the end of the day",
  "in conclusion",
  "game-changer",
  "paradigm shift",
  "synergize",
  "unlock the full potential",
  "embark on a journey",
  "navigate the complexities",
  "foster innovation",
  "drive meaningful change",
  "the tapestry of",
  "delves into",
  "the realm of",
  "leverage synergies",
  "holistic transformation",
  "innovative solutions",
  "empower stakeholders",
  "whether you're a beginner or professional",
  "whether you're a beginner or a professional",
  "without further ado",
  "let's dive in",
  "buckle up",
];

/**
 * QA-01: Word count check (1500-2000 target, 1200-2500 acceptable range)
 */
export function checkWordCount(content) {
  // Strip front matter before counting
  const bodyContent = content.replace(/^---[\s\S]*?---\s*/m, '').trim();
  const wordCount = bodyContent.split(/\s+/).filter(Boolean).length;

  if (wordCount < 1000) {
    return { pass: false, reason: `Too short: ${wordCount} words (minimum 1000)` };
  }
  if (wordCount > 3000) {
    return { pass: false, reason: `Too long: ${wordCount} words (maximum 3000)` };
  }
  return { pass: true, wordCount };
}

/**
 * QA-02: AI filler phrase detection
 */
export function checkFillerPhrases(content) {
  const lower = content.toLowerCase();
  const found = FILLER_PHRASES.filter(phrase => lower.includes(phrase));

  if (found.length > 0) {
    return { pass: false, reason: `AI filler phrases detected: ${found.join(', ')}` };
  }
  return { pass: true };
}

/**
 * QA-03: Post structure verification
 * Checks for Jekyll front matter, H2 headings, and prose content.
 */
export function checkStructure(content) {
  // Check front matter exists
  if (!content.startsWith('---')) {
    return { pass: false, reason: 'Missing Jekyll front matter (must start with ---)' };
  }

  const frontMatterEnd = content.indexOf('---', 3);
  if (frontMatterEnd === -1) {
    return { pass: false, reason: 'Incomplete Jekyll front matter (missing closing ---)' };
  }

  const frontMatter = content.slice(0, frontMatterEnd + 3);

  // Check required front matter fields
  const requiredFields = ['layout:', 'title:', 'description:', 'date:', 'categories:', 'tags:'];
  const missingFields = requiredFields.filter(field => !frontMatter.includes(field));
  if (missingFields.length > 0) {
    return { pass: false, reason: `Missing front matter fields: ${missingFields.join(', ')}` };
  }

  // Check H2 headings in body
  const body = content.slice(frontMatterEnd + 3);
  const h2Headings = body.split('\n').filter(l => /^## /.test(l));
  if (h2Headings.length < 3) {
    return { pass: false, reason: `Too few sections: ${h2Headings.length} H2 headings (minimum 3)` };
  }

  // Check there's actual prose content
  const proseLines = body.split('\n').filter(l =>
    l.trim().length > 0 &&
    !l.startsWith('#') &&
    l.trim() !== '---'
  );
  if (proseLines.length < 10) {
    return { pass: false, reason: 'Insufficient prose content' };
  }

  return { pass: true, sections: h2Headings.length };
}

/**
 * QA-04: FrameCoach mention check
 * Ensures FrameCoach is mentioned 2-3 times with a link.
 */
export function checkFrameCoachMentions(content) {
  const mentions = (content.match(/FrameCoach/gi) || []).length;
  const links = (content.match(/framecoach\.io/gi) || []).length;

  if (mentions < 2) {
    return { pass: false, reason: `Only ${mentions} FrameCoach mention(s) (need at least 2)` };
  }
  if (links < 1) {
    return { pass: false, reason: 'No link to framecoach.io found' };
  }

  return { pass: true, mentions, links };
}

/**
 * QA-05: SEO keyword presence check
 */
export function checkKeywordPresence(content, keyword) {
  if (!keyword) return { pass: true };

  const lower = content.toLowerCase();
  const kwLower = keyword.toLowerCase();
  const occurrences = lower.split(kwLower).length - 1;

  if (occurrences < 2) {
    return { pass: false, reason: `Target keyword "${keyword}" appears only ${occurrences} time(s) (need at least 2)` };
  }

  return { pass: true, occurrences };
}

/**
 * Aggregate validation: runs all checks and collects failures.
 */
export function validatePost(post) {
  const checks = [
    checkWordCount(post.content),
    checkFillerPhrases(post.content),
    checkStructure(post.content),
    checkFrameCoachMentions(post.content),
    checkKeywordPresence(post.content, post.keyword),
  ];

  const failures = checks.filter(c => !c.pass).map(c => c.reason);
  return { pass: failures.length === 0, failures };
}
