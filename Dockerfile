FROM node:22-bookworm-slim

WORKDIR /app

# Prisma requires OpenSSL at runtime and during client generation.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy the Prisma schema before dependency installation. package.json has a
# postinstall hook that runs prisma generate, which requires this schema.
COPY package.json ./
COPY prisma ./prisma

# There is currently no package-lock.json, so npm ci cannot be used yet.
# Skip lifecycle scripts until the full source tree is available.
RUN npm install --no-audit --no-fund --ignore-scripts

COPY . .

RUN npx prisma generate
RUN npm run build
# Fail the image build here instead of allowing a broken container to start.
RUN test -f .next/BUILD_ID

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

CMD ["npm", "run", "start:bothost"]
