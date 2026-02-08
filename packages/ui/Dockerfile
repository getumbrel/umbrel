FROM node:18.19.1-buster-slim

# Set the working directory
WORKDIR /app

# Copy the package.json and package-lock.json
COPY packages/ui/package.json ./
COPY packages/ui/package-lock.json ./

# Install the dependencies
RUN npm ci

# Copy the rest of the files
COPY packages/ui/ .

# Build the app
RUN npm run app-auth:build

# Expose the port
EXPOSE 2003

# Start the app
CMD ["npm", "run", "app-auth:start"]
