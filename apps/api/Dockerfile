# Genesis TypeScript API.
# Build from the repository root (the pnpm workspace and lockfile live there):
#   docker build -f apps/api/Dockerfile -t genesis-api .
# Normally started through the root docker-compose.yml.

FROM node:22-bookworm-slim

# Prisma's query engine needs OpenSSL.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.24.0

WORKDIR /app

# Manifests first so the dependency layer is cached until they change. apps/web only needs
# its manifest: the lockfile lists it as a workspace project.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter "@genesis/api..."

COPY apps/api apps/api
COPY packages/contracts packages/contracts
RUN pnpm --filter @genesis/api exec prisma generate \
 && pnpm --filter @genesis/api build

# Single stage keeps the pnpm symlinked node_modules intact. `pnpm deploy --prod` would slim
# the image if its size ever matters.
ENV NODE_ENV=production \
    PORT=8080
EXPOSE 8080
WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]
