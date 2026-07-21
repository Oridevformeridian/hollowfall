# Multi-stage build for Hollowfall production deployment
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Copy shared code
COPY shared ./shared

# Build client
COPY client/package*.json ./client/
RUN cd client && npm ci

COPY client ./client
RUN cd client && npm run build

# Build server
COPY server/package*.json ./server/
RUN cd server && npm ci

COPY server ./server
RUN cd server && npx prisma generate
RUN cd server && npm run build

# Final production image
FROM node:20-alpine

WORKDIR /usr/src/app

# Set production environment
ENV NODE_ENV=production
ENV PORT=8080

# Copy built server assets
COPY --from=builder /usr/src/app/server/package*.json ./server/
COPY --from=builder /usr/src/app/server/dist ./server/dist
COPY --from=builder /usr/src/app/server/node_modules ./server/node_modules

# Copy built client assets (since server serves client/dist in production)
COPY --from=builder /usr/src/app/client/dist ./client/dist

# Expose port (Cloud Run defaults to 8080)
EXPOSE 8080

WORKDIR /usr/src/app/server
CMD ["npm", "start"]
