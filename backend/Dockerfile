FROM node:20-bookworm-slim

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/server.js ./server.js
COPY backend/tickets ./tickets

ENV NODE_ENV=production
ENV PORT=5000
ENV PROLOG_BASE=http://127.0.0.1:8000

EXPOSE 5000

CMD ["node", "server.js"]