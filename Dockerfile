FROM node:22-alpine

RUN apk upgrade --no-cache

WORKDIR /app

COPY package*.json .npmrc* ./
RUN npm ci --omit=dev

COPY . .

RUN chmod +x docker-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["./docker-entrypoint.sh"]