# Build context is the repository root (see docker-compose.yml) so /database can be included.
FROM node:22-alpine
WORKDIR /app
COPY backend/package.json backend/
RUN cd backend && npm install --omit=dev
COPY backend backend
COPY database database
WORKDIR /app/backend
EXPOSE 4000
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]
