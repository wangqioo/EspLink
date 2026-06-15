FROM node:20-bookworm-slim

WORKDIR /app

# Use Chinese mirrors for apt
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update && apt-get install -y --no-install-recommends openssl git \
  && rm -rf /var/lib/apt/lists/*

# Use Chinese npm mirror
RUN npm config set registry https://registry.npmmirror.com

# Install backend dependencies
COPY package*.json ./
RUN npm install

# Install & build frontend
COPY admin-frontend/ ./admin-frontend/
WORKDIR /app/admin-frontend
RUN npm install && npm run build

# Backend source + Prisma
WORKDIR /app
COPY prisma/ ./prisma/
COPY src/ ./src/
RUN npx prisma generate

EXPOSE 8088

CMD ["node", "src/app.js"]
