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

# Create a link that expires (ISO 8601 date in the future)
curl -X POST localhost:3000/api/shorten \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "expiresAt": "2027-01-01T00:00:00.000Z"}'
# → {"code":"...","shortUrl":"...","expiresAt":"2027-01-01T00:00:00.000Z"}
# After expiry the short URL answers 410 Gone (clicks are not counted),
# and the stats endpoint reports "expired": true. An invalid or past
# expiresAt returns 400.
```

Links persist in `data.json` (override with the `DATA_FILE` env var); the base URL is set with `BASE_URL`.

## Roadmap

Custom aliases → per-link stats endpoint → link expiry → rate limiting. Full plan: [ROADMAP.md](ROADMAP.md).

## License

MIT — see [LICENSE](LICENSE).
