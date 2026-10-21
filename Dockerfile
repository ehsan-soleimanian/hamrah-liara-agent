FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATA_DIR=/app/data
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/types.ts ./src/types.ts
COPY demo ./demo
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3001/api/health',{headers:{Authorization:'Basic '+Buffer.from('hamrah:'+process.env.DASHBOARD_PASSWORD).toString('base64')}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server/launcher.ts"]
