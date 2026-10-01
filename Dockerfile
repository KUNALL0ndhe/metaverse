# One container serves the web client, the WebSocket server and your map.
#   docker build -t metaverse .
#   docker run -p 8080:8080 metaverse

FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "client..." --filter "realtime..."
RUN pnpm build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/apps/realtime/dist apps/realtime/dist
COPY --from=build /app/apps/client/dist apps/client/dist
COPY --from=build /app/maps maps
EXPOSE 8080
CMD ["node", "apps/realtime/dist/index.js"]
