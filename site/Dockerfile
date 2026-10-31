# 官网构建器：容器里定时（每天 04:00 UTC+8）抓价格 → 构建 → 原子切换到共享卷，由 deploy/compose.yml 里的 nginx 提供服务。
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
CMD ["node", "deploy/builder.mjs"]
