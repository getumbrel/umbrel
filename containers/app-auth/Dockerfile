# UI build stage
FROM node:18.19.1-buster-slim as umbrel-app-auth-ui-builder

# Install pnpm
RUN npm install -g pnpm@8

# Set the working directory
WORKDIR /app

# Copy the package.json and package-lock.json
COPY packages/ui/package.json ./
COPY packages/ui/pnpm-lock.yaml ./

# Install the dependencies
RUN pnpm install

# Copy the rest of the files
COPY packages/ui/ .

# Build the app
RUN pnpm run app-auth:build

# Expose the port
EXPOSE 2003

# Start the app
CMD ["pnpm", "run", "app-auth:start"]

# Build Stage
FROM node:16-buster-slim as umbrel-app-auth-builder

# Create app directory
WORKDIR /app

# Copy 'yarn.lock' and 'package.json'
COPY containers/app-auth/yarn.lock containers/app-auth/package.json ./

# Install dependencies
RUN yarn

# Copy project files and folders to the current working directory (i.e. '/app')
COPY containers/app-auth .

# Final image
FROM node:16-buster-slim AS umbrel-app-auth

# Copy built code from build stage to '/app' directory
COPY --from=umbrel-app-auth-builder /app /app

# Copy built ui to /app/dist
COPY --from=umbrel-app-auth-ui-builder /app/dist-app-auth /app/dist

# Change directory to '/app'
WORKDIR /app

CMD [ "yarn", "start" ]
