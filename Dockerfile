# Shortly — zero-dependency URL shortener, containerised.
# One-command deployment:  docker compose up -d   (or see README)
FROM node:20-alpine

# No npm install needed: Shortly has zero dependencies, so the image is
# just the Node runtime plus the three source files.
WORKDIR /app
COPY package.json server.js qr.js ./

# Links persist in /data (a volume), so they survive container restarts.
# PORT and BASE_URL stay overridable at run time.
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_FILE=/data/data.json
RUN mkdir -p /data && chown node:node /data

USER node
VOLUME /data
EXPOSE 3000

# A dedicated health endpoint: /health answers 200 with the link
# count and uptime, without touching the link store.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]
