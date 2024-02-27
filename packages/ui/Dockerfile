FROM node:18.19.1-buster-slim

# Install pnpm
RUN npm install -g pnpm

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