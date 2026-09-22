FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./

# This repository currently has no package-lock.json, so npm ci cannot run here.
# Use npm install for the first Bothost build, then commit a lockfile for reproducible builds.
RUN npm install --no-audit --no-fund

COPY . .

RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

CMD ["npm", "run", "start:bothost"]
