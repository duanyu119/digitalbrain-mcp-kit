FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY src ./src
USER node
ENV HOST=0.0.0.0 PORT=8787 DATA_DIR=/data AUTH_DIR=/auth STATE_DIR=/state
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD ["node", "src/healthcheck.mjs"]
CMD ["node", "--experimental-strip-types", "src/server.ts"]
