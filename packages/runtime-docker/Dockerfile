FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /opt/workstate

RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/runtime-local/package.json packages/runtime-local/package.json
COPY packages/runtime-docker/package.json packages/runtime-docker/package.json

RUN pnpm install --frozen-lockfile --filter @workstate/runtime-docker...

COPY packages/sdk packages/sdk
COPY packages/runtime-local packages/runtime-local
COPY packages/runtime-docker packages/runtime-docker

RUN pnpm exec tsc -p packages/sdk/tsconfig.json \
  && pnpm exec tsc -p packages/runtime-local/tsconfig.json \
  && pnpm exec tsc -p packages/runtime-docker/tsconfig.json

ENV WORKSTATE_DAEMON_PORT=4790
EXPOSE 4790

CMD ["node", "packages/runtime-docker/dist/daemon.js"]
