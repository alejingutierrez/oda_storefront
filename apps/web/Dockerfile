# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache libc6-compat
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
COPY package.json package-lock.json ./
COPY . .
RUN npm ci
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json

EXPOSE 3000
CMD ["npm", "run", "start"]
