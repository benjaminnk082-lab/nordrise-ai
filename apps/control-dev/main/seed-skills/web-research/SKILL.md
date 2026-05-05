---
name: web-research
description: Browse the web for current external information using Firecrawl.
when_to_use: When the user asks about something current, factual, or external (a news event, a product price today, a person's role at a company right now). NOT for general knowledge already in your training data.
required_tools:
  - firecrawl_scrape
  - firecrawl_search
files:
  - research-template.md
---

# Web research

Goal: answer the user's question with current sources, cited.

## Procedure

1. **Frame the query**. Identify the *specific fact* the user needs.
   Avoid scraping for general background — that wastes Firecrawl credits.
2. **Search first, scrape second**. Run `firecrawl_search` with 2-4
   keywords. Read the snippets. Pick the 1-2 highest-signal URLs.
3. **Scrape the picks**. `firecrawl_scrape` each URL. Extract the fact.
4. **Cite inline**. Quote a single sentence per source with the URL on
   the next line. Don't paraphrase the whole article.
5. **Stop when you have an answer**. Do not chain more than 4 fetches
   per question — if you can't find it in 4 hops, surface that.

## Output shape

```
**Answer:** <one sentence>

**Sources:**
- "<quoted sentence>"
  <URL>
- "<quoted sentence>"
  <URL>
```

## Don'ts

- Don't scrape `localhost`, intranet, or `*.internal` URLs from this skill.
- Don't include the whole scraped page in your reply — only the sentence
  that supports your answer.
- Don't run `firecrawl_search` more than twice for one question.
