# KIMS Queue backend — production container.
# Uses Node's built-in node:sqlite (Node >= 22.5). No native deps to compile.
FROM node:22-slim

WORKDIR /app

# Install prod deps only (cached by Docker layer).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source AFTER install (see .dockerignore — excludes node_modules & dev data,
# so the installed deps above are not overwritten).
COPY . .

ENV NODE_ENV=production
# Hosts usually inject PORT (and honour HOST); safe defaults below.
ENV PORT=8080
ENV HOST=0.0.0.0

# Persistent SQLite storage. The database is written to /app/data/queue.db
# (see config/db.js DB_PATH). Mount a persistent volume here on your host so
# data survives restarts. Seed it once: cd backend && npm run seed
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8080

# Health check against the existing /health endpoint (Node 18+ has global fetch).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]