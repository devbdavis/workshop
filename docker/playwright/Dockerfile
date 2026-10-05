# Workshop's optional Design Mode screenshot sidecar. Pinned to the same
# playwright version as package.json so the installed browsers match the
# library version exactly.
FROM mcr.microsoft.com/playwright:v1.55.0-noble

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.mjs ./

USER pwuser
EXPOSE 3100
CMD ["node", "server.mjs"]
