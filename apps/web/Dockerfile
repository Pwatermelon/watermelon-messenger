# Контекст сборки: корень репозитория
# Не задаём VITE_API_URL/VITE_WS_URL — в рантайме используем тот же хост (origin), nginx проксирует /api и /ws
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY packages ./packages
COPY apps/web ./apps/web

WORKDIR /app/apps/web
ARG WM_VERSION=dev
ARG VITE_YANDEX_MAPS_API_KEY=
ENV VITE_APP_VERSION=${WM_VERSION}
ENV VITE_YANDEX_MAPS_API_KEY=${VITE_YANDEX_MAPS_API_KEY}
RUN npm install
RUN npm run build

# Раздача статики через nginx
FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
