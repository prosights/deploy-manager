FROM node:24-alpine

WORKDIR /app

ARG APP_VERSION=local
ENV APP_VERSION=${APP_VERSION}
ENV PORT=8080

COPY app/server.js ./server.js

EXPOSE 8080

CMD ["node", "server.js"]
