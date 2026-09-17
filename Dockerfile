# syntax=docker/dockerfile:1

# Builder: full install (devDeps for tsc) + production build.
# patches/ must be present before install: postinstall applies them.
FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY patches ./patches
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runner: production-only deps, prebuilt dist, non-root user.
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY patches ./patches
RUN npm ci --omit=dev && npm cache clean --force \
	&& mkdir -p /app/data /app/logs && chown -R node:node /app
COPY --from=builder --chown=node:node /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]
