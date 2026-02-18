ARG WEB_BASE_IMAGE=ghcr.io/niaexperience/nia-web-base:latest
FROM ${WEB_BASE_IMAGE} AS base
WORKDIR /app

# Build arguments for Next.js public environment variables
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_TWILIO_ACCOUNT_SID
ARG NEXT_PUBLIC_TWILIO_AUTH_TOKEN
ARG NEXT_PUBLIC_DAILY_ROOM_URL
ARG NEXT_PUBLIC_BOT_CONTROL_BASE_URL
ARG NEXT_PUBLIC_BOT_AUTO_JOIN
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_PROXY_HOST

# Expose build args to the Next.js build environment so client code can inline them
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
	NEXT_PUBLIC_TWILIO_ACCOUNT_SID=$NEXT_PUBLIC_TWILIO_ACCOUNT_SID \
	NEXT_PUBLIC_TWILIO_AUTH_TOKEN=$NEXT_PUBLIC_TWILIO_AUTH_TOKEN \
	NEXT_PUBLIC_DAILY_ROOM_URL=$NEXT_PUBLIC_DAILY_ROOM_URL \
	NEXT_PUBLIC_BOT_CONTROL_BASE_URL=$NEXT_PUBLIC_BOT_CONTROL_BASE_URL \
	NEXT_PUBLIC_BOT_AUTO_JOIN=$NEXT_PUBLIC_BOT_AUTO_JOIN \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_PROXY_HOST=$NEXT_PUBLIC_POSTHOG_PROXY_HOST

# Development image
FROM base AS dev
COPY apps/interface ./apps/interface
COPY apps/sprite-maker ./apps/sprite-maker
ENV NODE_ENV=development
ENV HOSTNAME=0.0.0.0
ENV NODE_OPTIONS="--max-old-space-size=4096"
CMD ["npm", "run", "--workspace=apps/interface", "dev"]

# Builder image
FROM base AS builder
COPY apps/interface ./apps/interface
COPY apps/sprite-maker ./apps/sprite-maker
RUN npm run --workspace=apps/interface build
RUN npm prune --omit=dev && npm cache clean --force && rm -rf /root/.npm

# Production image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# Create non-root user for security hardening
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

# Remove global npm (bundled deps carry legacy glob/cross-spawn); not needed at runtime
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Copy built app and node_modules
COPY --from=builder /app/apps/interface/.next .next
COPY --from=builder /app/apps/interface/public ./public
COPY --from=builder /app/apps/sprite-maker ./apps/sprite-maker
COPY --from=builder /app/apps/interface/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
# Copy built prism package (dist + package.json) for runtime
COPY --from=builder /app/packages/prism/dist ./node_modules/@nia/prism/dist
COPY --from=builder /app/packages/prism/package.json ./node_modules/@nia/prism/package.json
# Copy built events package (dist + package.json) for runtime
COPY --from=builder /app/packages/events/dist ./node_modules/@nia/events/dist
COPY --from=builder /app/packages/events/package.json ./node_modules/@nia/events/package.json

# Remove npm CLI and build-only tools from runtime image to reduce attack surface
RUN rm -rf /app/node_modules/esbuild /app/node_modules/@esbuild

# Set ownership and switch to non-root user
RUN chown -R nextjs:nodejs /app
USER nextjs

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "node_modules/next/dist/bin/next", "start"]
