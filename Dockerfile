FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    git \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
EXPOSE 3000
CMD ["npm", "start"]
