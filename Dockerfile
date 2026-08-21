# Production image for Garagedoor.
# Build:  docker build -t garagedoor .
# Run:    docker run -p 3000:3000 \
#           -e GARAGE_ADMIN_ENDPOINT=http://garage:3903 \
#           -e GARAGE_ADMIN_TOKEN=... \
#           garagedoor

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
# Persisted resync history (mount a volume here to keep it across restarts)
RUN mkdir -p /data && chown app:app /data
ENV GARAGEDOOR_DATA_DIR=/data
VOLUME /data
USER app
EXPOSE 3000
CMD ["node", "server.js"]
