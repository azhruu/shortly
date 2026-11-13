# Shortly

**A tiny URL shortener API in pure Node.js — zero dependencies.** No Express, no npm install: just `node server.js`.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)
![Status](https://img.shields.io/badge/status-actively%20building-brightgreen?style=for-the-badge)

## Run it

```bash
node server.js            # http://localhost:3000
```

Open the landing page to shorten a link in the browser, or use the API:

## API

```bash
# Create a short link
curl -X POST localhost:3000/api/shorten \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com/a/very/long/link"}'
# → {"code":"aB3xK9","shortUrl":"http://localhost:3000/aB3xK9"}

# Create a short link with a custom alias (1-30 chars: letters, digits, _ or -)
curl -X POST localhost:3000/api/shorten \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "alias": "my-link"}'
# → {"code":"my-link","shortUrl":"http://localhost:3000/my-link"}
# A taken or invalid alias returns 409 / 400 with an error message.

# Use it (302 redirect, click counted)
curl -i localhost:3000/aB3xK9

# List all links with click counts
curl localhost:3000/api/links

# Stats for one link (clicks, created, last click)
curl localhost:3000/api/links/aB3xK9
# → {"code":"aB3xK9","url":"https://example.com/a/very/long/link","shortUrl":"http://localhost:3000/aB3xK9","clicks":1,"created":"...","lastClicked":"..."}
# Unknown codes return 404 with an error message.

# Delete a link (its short URL stops redirecting)
curl -X DELETE localhost:3000/api/links/aB3xK9
# → {"code":"aB3xK9","deleted":true}
# Unknown codes return 404 with an error message.

# Create a link that expires (ISO 8601 date in the future)curl -X POST localhost:3000/api/shorten \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "expiresAt": "2027-01-01T00:00:00.000Z"}'
# → {"code":"...","shortUrl":"...","expiresAt":"2027-01-01T00:00:00.000Z"}
# After expiry the short URL answers 410 Gone (clicks are not counted),
# and the stats endpoint reports "expired": true. An invalid or past
# expiresAt returns 400.
```

Links persist in `data.json` (override with the `DATA_FILE` env var); the base URL is set with `BASE_URL`.

## Tests

Automated endpoint tests using only Node's built-in test runner — no dependencies:

```bash
npm test            # node --test test/*.test.js
```

`test/api.test.js` starts the real server on an ephemeral port with a throwaway data file and covers creating links, redirects with click counting, listing and stats, custom aliases (including clashes), invalid input, oversized bodies, link expiry (410 after expiry), and deletes. `test/rate-limit.test.js` verifies the 30-per-minute cap trips on the 31st request with a 429 and a `Retry-After` header.

## Limits

- URLs are capped at 2048 characters (longer ones get a 400).
- Request bodies are capped at 64 KiB (larger ones get a 413).
- Aliases are 1–30 characters: letters, digits, `_` or `-`.
- POST /api/shorten is rate-limited to 30 requests per minute per IP (excess requests get a 429 with a `Retry-After` header).

## Roadmap

Custom aliases → per-link stats endpoint → link expiry → rate limiting → automated endpoint tests. Full plan: [ROADMAP.md](ROADMAP.md).

## License

MIT — see [LICENSE](LICENSE).
