FROM node:22-bookworm-slim

WORKDIR /app

# Copy the Prisma schema before npm install. package.json has a postinstall
# hook that runs `prisma generate`, which requires prisma/schema.prisma.
COPY package.json ./
COPY prisma ./prisma

# The repository currently has no package-lock.json, so npm ci cannot run.
# Install dependencies without executing postinstall yet; Prisma is generated
# explicitly after the complete source tree is copied below.
RUN npm install --no-audit --no-fund --ignore-scripts

COPY . .

RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

CMD ["npm", "run", "start:bothost"]
