# Shortly — Build Roadmap

Each item lands as one complete, tested change.

- [x] Core API: POST /api/shorten, GET /:code redirect with click counting, GET /api/links, JSON persistence, landing page
- [x] Custom aliases (POST with preferred code, clash handling)
- [x] Per-link stats endpoint (GET /api/links/:code)
- [x] DELETE /api/links/:code
- [x] Link expiry (optional expiresAt on create, 410 after expiry)
- [x] Input hardening: max URL length, body size limit
- [x] Basic rate limiting per IP on POST
- [x] Automated endpoint tests (node:test)
- [x] QR code for a short link (landing page)
- [x] Dockerfile for one-command deployment
- [x] Health endpoint (GET /health: status, link count, uptime) used by the Docker health check
- [x] List endpoint reports each link's expired flag, matching the stats endpoint (polish)
- [x] Health endpoint reports expired link count, so monitors can spot dead links without listing them (polish)
- [x] HEAD on a short code returns the redirect headers without counting a click, so previewers can probe a link without inflating its stats (polish)
- [x] Bulk purge of expired links (DELETE /api/links/expired, "expired" now a reserved alias) (polish)
