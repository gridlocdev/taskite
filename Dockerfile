# Taskite for a NAS: builds the web client, then runs the Node server (no npm dependencies) from source.
FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @taskite/web...
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @taskite/web build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/core packages/core
COPY packages/node-files packages/node-files
COPY apps/server/package.json apps/server/
# Links the workspace packages the server imports; none of them has an npm dependency.
RUN pnpm install --frozen-lockfile --prod --filter @taskite/server... && rm -rf /root/.cache /root/.local
COPY apps/server/src apps/server/src
COPY --from=build /src/apps/web/dist web
ENV NODE_ENV=production TASKITE_DATA=/data TASKITE_STATIC=/app/web TASKITE_HOST=0.0.0.0 TASKITE_PORT=8788
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8788
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8788/api/info >/dev/null || exit 1
CMD ["node", "apps/server/src/main.ts"]
