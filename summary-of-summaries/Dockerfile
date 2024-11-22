FROM node:latest as builder
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build

FROM nginx:latest as runner
COPY --from=builder /app/dist /usr/share/nginx/html
