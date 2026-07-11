# Build Stage
FROM caddy:2.7.6-alpine AS umbrel-caddy

# Final image
FROM caddy:2.7.6-alpine AS umbrel-caddy-final

# Create caddy directory
WORKDIR /config

# Copy Caddyfile from build stage
COPY --from=umbrel-caddy /usr/bin/caddy /usr/bin/caddy

# Expose HTTP and HTTPS ports
EXPOSE 80 443 2019

# Run Caddy
CMD ["caddy", "run", "--config", "/config/Caddyfile", "--adapter", "caddyfile"]
