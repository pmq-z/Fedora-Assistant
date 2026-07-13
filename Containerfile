# Containerfile
#
# Built and run with podman (Fedora's native, daemonless, rootless-by-default
# container engine) - see the "Running with Podman" section in README.md.
# This file has no Docker-specific syntax, so `docker build` also works
# unmodified if you ever need it, but podman is the intended/tested engine.
#
# ---------------------------------------------------------------------------
# Stage 1: install dependencies
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Only copy manifests first so this layer is cached unless dependencies change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------
# Stage 2: runtime image
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime

# Run as a non-root user inside the container. Combined with podman's
# rootless mode + user namespace remapping, this means "root" in here still
# maps to an unprivileged UID on the host - defense in depth, not just
# inside-container hygiene.
RUN addgroup -S mentor && adduser -S mentor -G mentor

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY api ./api
COPY routes ./routes
COPY prompts ./prompts
COPY frontend ./frontend

# settings.json and chats/ are meant to be bind-mounted or podman-volume-
# mounted from the host so they persist across container recreation - see
# the run command in README.md. We still create sane defaults/placeholders
# here so the image works standalone if someone forgets to mount them.
COPY settings.json ./settings.json
RUN mkdir -p chats && chown -R mentor:mentor /app

USER mentor

ENV PORT=3000
EXPOSE 3000

# Basic container healthcheck - hits our own /api/settings endpoint (always
# answers even if Ollama itself is unreachable, so this reflects "is the
# Node process alive and serving", not "is Ollama up").
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/settings || exit 1

CMD ["node", "server.js"]
