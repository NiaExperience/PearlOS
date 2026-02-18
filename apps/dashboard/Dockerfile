ARG WEB_BASE_IMAGE=ghcr.io/niaexperience/nia-web-base:latest
FROM ${WEB_BASE_IMAGE} AS base
WORKDIR /app

# Build arguments for Next.js public environment variables
ARG NEXT_PUBLIC_AWS_REGION
ARG NEXT_PUBLIC_AWS_S3_BUCKET_NAME
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_INTERFACE_BASE_URL

# Build dashboard app
# Expose build args as environment variables so Next.js inlines them in the client bundle
ENV \
	NEXT_PUBLIC_AWS_REGION=${NEXT_PUBLIC_AWS_REGION} \
	NEXT_PUBLIC_AWS_S3_BUCKET_NAME=${NEXT_PUBLIC_AWS_S3_BUCKET_NAME} \
	NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL} \
	NEXT_PUBLIC_INTERFACE_BASE_URL=${NEXT_PUBLIC_INTERFACE_BASE_URL}

# Development image
FROM base AS dev
COPY apps/dashboard ./apps/dashboard
ENV NODE_ENV=development
ENV HOSTNAME=0.0.0.0
ENV NODE_OPTIONS="--max-old-space-size=4096"
CMD ["npm", "run", "--workspace=apps/dashboard", "dev"]

# Builder image
FROM base AS builder
COPY apps/dashboard ./apps/dashboard
# Build features package (needed for template sync) and dashboard
RUN npm run --workspace=@nia/features build && npm run --workspace=dashboard build && \
	npm prune --omit=dev && npm cache clean --force && rm -rf /root/.npm

# Production image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV HOSTNAME=0.0.0.0

# Create non-root user for security hardening
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

# Remove global npm (bundled deps carry legacy glob/cross-spawn); not needed at runtime
RUN rm -rf /usr/local/lib/node_modules/npm

# Copy built app and node_modules
COPY --from=builder /app/apps/dashboard/.next .next
COPY --from=builder /app/apps/dashboard/public ./public
COPY --from=builder /app/apps/dashboard/package.json ./package.json
COPY --from=builder /app/apps/dashboard/scripts ./scripts
COPY --from=builder /app/node_modules ./node_modules
# Copy built prism package (dist + package.json) for runtime
COPY --from=builder /app/packages/prism/dist ./node_modules/@nia/prism/dist
COPY --from=builder /app/packages/prism/package.json ./node_modules/@nia/prism/package.json
# Copy built events package (dist + package.json) for runtime
COPY --from=builder /app/packages/events/dist ./node_modules/@nia/events/dist
COPY --from=builder /app/packages/events/package.json ./node_modules/@nia/events/package.json
# Copy built features package (dist + package.json) for runtime (needed for template sync)
COPY --from=builder /app/packages/features/dist ./node_modules/@nia/features/dist
COPY --from=builder /app/packages/features/package.json ./node_modules/@nia/features/package.json

# Drop build-time tooling (esbuild) from runtime
RUN rm -rf /app/node_modules/esbuild /app/node_modules/@esbuild*

# Set ownership and switch to non-root user
RUN chown -R nextjs:nodejs /app
USER nextjs

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

EXPOSE 4000

CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "4000"]
