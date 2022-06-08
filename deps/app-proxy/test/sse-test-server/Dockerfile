# Build Stage
FROM node:16-buster-slim as umbrel-sse-test-server-builder

# Create app directory
WORKDIR /app

# Copy 'yarn.lock' and 'package.json'
COPY yarn.lock package.json ./

# Install dependencies
RUN yarn install --production

# Copy project files and folders to the current working directory (i.e. '/app')
COPY . .

# Final image
FROM node:16-buster-slim AS umbrel-sse-test-server

# Copy built code from build stage to '/app' directory
COPY --from=umbrel-sse-test-server-builder /app /app

# Change directory to '/app'
WORKDIR /app

CMD [ "yarn", "start" ]
