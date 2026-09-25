FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
ENV DATA_DIR=/data
ENV APP_MODE=local
ENV HOST=0.0.0.0
ENV PORT=3001
EXPOSE 3001
CMD ["node", "scripts/local-dev-server.mjs"]
