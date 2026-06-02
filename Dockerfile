FROM node:22-alpine

WORKDIR /app

COPY package*.json .npmrc* ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8080

CMD ["npm", "run", "start:prod"]