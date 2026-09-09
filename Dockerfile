FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libu2f-udev \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# QR codes are no longer exposed or used for pairing. WhatsApp pairing is phone-number/code only.
RUN sed -i "/const QRCode = require('qrcode');/d; /client.on('qr', async qr => {/,+7d; s#<p><a href=\\\"/qr\\\">Open QR code</a></p>##g; s#<p style=\\\"margin-top:25px\\\"><a href=\\\"/qr\\\">Use QR instead</a></p>##g; s#The QR method is still available\\.##g; s#<p><a href=\\\"/qr\\\">Use QR</a></p>##g" index.js

EXPOSE 3000
CMD ["npm", "start"]
