# Copyright 2024 Google LLC
# SPDX-License-Identifier: Apache-2.0

FROM node:latest as builder
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build

FROM nginx:latest as runner
COPY --from=builder /app/build /usr/share/nginx/html
