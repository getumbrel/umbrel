# Build Stage
FROM node:16-buster-slim as umbrel-app-auth-builder

# Create app directory
WORKDIR /app

# Copy 'yarn.lock' and 'package.json'
COPY yarn.lock package.json ./

# Install dependencies
RUN yarn

# Copy project files and folders to the current working directory (i.e. '/app')
COPY . .

# Build frontend (vue app)
RUN yarn build

# Final image
FROM node:16-buster-slim AS umbrel-app-auth

# Copy built code from build stage to '/app' directory
COPY --from=umbrel-app-auth-builder /app /app

# Change directory to '/app'
WORKDIR /app

CMD [ "yarn", "start" ]
