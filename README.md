# FrameCoach Blog Engine

Automated blog content engine for the [FrameCoach blog](https://theshumba.github.io/framecoach-blog/). Generates filmmaking blog posts via Gemini 2.5 Flash and publishes them to GitHub Pages every 3 days.

## How It Works

1. **Ingest** -- Fetches trending filmmaking news from 5 RSS feeds (No Film School, PetaPixel, IndieWire, Google News)
2. **Generate** -- Selects a topic based on current news + next SEO keyword in rotation, then writes a 1500-2000 word blog post via Gemini
3. **Validate** -- Quality gates check word count, AI filler phrases, post structure, FrameCoach mentions, and keyword presence
4. **Publish** -- Commits the new post to `theshumba/framecoach-blog` which triggers GitHub Pages deploy

## Stack

- Node.js 22 (ESM)
- @google/genai (Gemini 2.5 Flash)
- rss-parser
- pino (logging)

## Secrets Required

| Secret | Description |
|--------|-------------|
| `GEMINI_API_KEY` | Google AI API key for Gemini |
| `BLOG_DEPLOY_TOKEN` | GitHub PAT with `repo` scope to push to framecoach-blog |

## Manual Run

```bash
# Local development
export GEMINI_API_KEY=your-key-here
npm install
npm start

# Pretty logs
npm run start:pretty
```

Or trigger manually from the GitHub Actions UI (workflow_dispatch).

## Keyword Rotation

The engine rotates through 55+ SEO keywords defined in `config/keywords.json`. Each run picks the next unused keyword, ensuring full coverage before repeating. State is tracked in `state/published-log.json`.

## Quality Gates

- Word count: 1000-3000 words (target 1500-2000)
- No AI filler phrases (30+ banned phrases)
- Jekyll front matter validation (all required fields)
- FrameCoach mentioned 2-3 times with link to framecoach.io
- Target keyword appears 2+ times in content
- Proper H2 structure (minimum 3 sections)
