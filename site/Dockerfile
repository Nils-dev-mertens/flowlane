# ---------------------------
# Build stage (Node)
# ---------------------------
# Build context is the repo root: Footer.astro / CTA.astro import
# ../../../package.json (root) for the version number.
FROM node:20-alpine AS builder

WORKDIR /app

# Root files needed at build time:
# - package.json  -> version import in Footer.astro / CTA.astro
# - INSTALL.md / README.md / LICENSE.md / docs/ -> rendered by the docs pages
COPY package.json INSTALL.md README.md LICENSE.md ./
COPY docs ./docs

# Install site dependencies first (better layer caching)
COPY site/package.json site/package-lock.json ./site/
RUN cd site && npm ci

# Copy the rest of the site
COPY site ./site

# Build Astro (outputs to /app/site/dist)
RUN cd site && npm run build

# ---------------------------
# Runtime stage (Nginx)
# ---------------------------
FROM nginx:alpine

# Copy built Astro files to Nginx web root
COPY --from=builder /app/site/dist /usr/share/nginx/html
COPY site/nginx.conf /etc/nginx/conf.d/default.conf

# Expose HTTP port (host port is mapped at `docker run`)
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]