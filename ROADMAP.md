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
- [ ] QR code for a short link (landing page)
- [ ] Dockerfile for one-command deployment
