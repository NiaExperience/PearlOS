# Build stage
FROM node:20-alpine AS deps
WORKDIR /app

# Cache buster - change to force npm ci to re-run
ARG CACHEBUST=1

# Copy build dependencies
COPY tsconfig.json ./
COPY package.json package-lock.json* .npmrc* ./
COPY packages/prism/package.json ./packages/prism/
COPY packages/prism/tsconfig.json ./packages/prism/
COPY packages/prism/tsconfig.build.json ./packages/prism/
COPY packages/prism/tsconfig.server.json ./packages/prism/
COPY apps/mesh/package.json ./apps/mesh/
COPY scripts/setup-env.mjs ./scripts/setup-env.mjs

# Install all dependencies (including workspaces)
RUN npm ci

# Copy full source
COPY . .

# Build prism package first (server-only, excludes UI components)
RUN npm run --workspace=@nia/prism build:server

# Build mesh app
RUN npm run build -w @nia/mesh-server

# Production stage
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy built app and node_modules
COPY --from=deps /app/apps/mesh/dist ./dist
COPY --from=deps /app/apps/mesh/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
# Copy the built prism package and workspace config
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/package.json ./workspace-package.json


# Set environment variables
ENV NODE_ENV=production
ENV PORT=2000

# Remove npm CLI and unused build tooling from runtime image to reduce attack surface
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  /app/node_modules/esbuild /app/node_modules/@esbuild

# Expose the port
EXPOSE 2000

# Start the server
CMD ["node", "dist/server.js"]
