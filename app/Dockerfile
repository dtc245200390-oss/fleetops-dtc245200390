FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --fetch-retries=5 \
    && node -e "require('express'); require('pg'); require('prom-client')" \
    && npm cache clean --force
COPY --chown=node:node . .
# Hardening: chạy bằng user non-root "node"
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server.js"]
