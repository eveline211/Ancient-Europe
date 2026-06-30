# Period content schema

Each file in `data/periods/{period-id}.json` follows this shape:

```jsonc
{
  "id": "lgm",                  // matches periods.json
  "info": "string",             // short orienting summary (1-3 sentences) — shown first in the Info tab
  "background": "string",       // fuller narrative — the deep-dive tab
  "flora": [
    { "name": "...", "latin": "...", "note": "..." }
  ],
  "fauna": [
    { "name": "...", "latin": "...", "note": "..." }
  ],
  "people": [
    { "name": "...", "role": "...", "note": "..." }
  ],
  "video": {
    "url": null,                // YouTube/Vimeo embed URL, null = placeholder
    "caption": "..."
  }
}
```

Status of content per period (June 2026 scaffold):
- `background`: populated for all 10 periods from the period-descriptions document
- `info`: placeholder short summary written for each (needs editorial pass)
- `flora`: empty arrays — needs species data per period
- `fauna`: only LGM has 2 example entries (from wireframe); rest empty
- `people`: empty for all — per earlier discussion, this is historical/prehistoric figures relevant to that period (likely sparse for LGM-era periods, richer toward Atlantic/Present)
- `video`: all null placeholders
