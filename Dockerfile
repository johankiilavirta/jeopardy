# Relay server only — the web/iOS client is built separately with Expo.
# The relay needs just tsx (TS runtime) and ws; the game logic in src/
# has no external dependencies, so we skip the whole Expo tree.
FROM node:22-slim

WORKDIR /app

RUN npm install tsx@^4.19.4 ws@^8.18.1

COPY relay ./relay
COPY src ./src
COPY data/seasons ./data/seasons

ENV NODE_ENV=production
EXPOSE 8787

CMD ["npx", "tsx", "relay/index.ts"]
