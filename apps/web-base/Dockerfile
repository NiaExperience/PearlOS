# Shared base image for web apps (interface + dashboard)
# Installs dependencies, builds shared packages, and leaves workspace ready for app builds
FROM node:20-alpine AS base
WORKDIR /app

# Build deps for native modules (lmdb, sqlite3, etc.)
RUN apk add --no-cache python3 py3-setuptools make g++ libc-dev

# Disable husky hooks in container builds
ARG HUSKY=0
ENV HUSKY=0

# Copy workspace manifests and configs
COPY tsconfig.json ./
COPY package.json package-lock.json* .npmrc* ./
COPY packages/prism/package.json ./packages/prism/
COPY packages/prism/tsconfig.json ./packages/prism/
COPY packages/prism/tsconfig.build.json ./packages/prism/
COPY packages/events/package.json ./packages/events/
COPY scripts/setup-env.mjs ./scripts/setup-env.mjs
COPY apps/interface/package.json ./apps/interface/
COPY apps/dashboard/package.json ./apps/dashboard/

# Install dependencies (workspaces)
RUN npm ci && npm cache clean --force && rm -rf /root/.npm

# Copy full source for shared packages and workspaces
COPY . .

# Build shared packages up front
RUN npm run --workspace=@nia/prism build
RUN npm run --workspace=@nia/events build
