ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node backend/src/ ./src/
COPY --chown=node:node backend/migrations/ ./migrations/
COPY --chown=node:node backend/test/ ./test/
COPY --chown=node:node src/engine.js /app/src/engine.js
COPY --chown=node:node src/aircraft.js /app/src/aircraft.js
USER node
EXPOSE 4317
CMD ["node", "src/server.js"]
