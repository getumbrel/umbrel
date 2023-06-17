# Build Stage
FROM node:12-buster-slim as umbrel-manager-builder

# Install tools
RUN apt-get update && apt-get install -y build-essential libffi-dev libssl-dev python3

# Create app directory
WORKDIR /app

# Copy 'yarn.lock' and 'package.json'
COPY yarn.lock package.json ./

# Install dependencies
RUN yarn install --production

# Copy project files and folders to the current working directory (i.e. '/app')
COPY . .

# Final image
FROM node:12-buster-slim AS umbrel-manager

# Copy built code from build stage to '/app' directory
COPY --from=umbrel-manager-builder /app /app

# Change directory to '/app'
WORKDIR /app

EXPOSE 3006
CMD [ "yarn", "start" ]
