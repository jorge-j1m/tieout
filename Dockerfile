# The app image (topology §Stage 3): serves the Hono API by default; the same
# image runs the one-shot migrate gate with a command override — one artifact,
# no drift between "what migrated" and "what serves".
#
#   docker build -t tieout .
#   docker run tieout                                        # api on :3001
#   docker run tieout pnpm --filter @tieout/db run migrate   # migrate gate

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
# Production deps only, and only for the api and its workspace dependencies —
# jobs/adapters/seed stay on Trigger.dev Cloud and never enter this image.
RUN pnpm install --frozen-lockfile --prod --filter @tieout/api... --filter @tieout/db...

FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
EXPOSE 3001
CMD ["pnpm", "--filter", "@tieout/api", "start"]
