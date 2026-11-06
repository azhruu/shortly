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

# Use it (302 redirect, click counted)
curl -i localhost:3000/aB3xK9

# List all links with click counts
curl localhost:3000/api/links
```

Links persist in `data.json` (override with the `DATA_FILE` env var); the base URL is set with `BASE_URL`.

## Roadmap

Custom aliases → link expiry → per-link stats endpoint → rate limiting. Full plan: [ROADMAP.md](ROADMAP.md).

## License

MIT — see [LICENSE](LICENSE).
