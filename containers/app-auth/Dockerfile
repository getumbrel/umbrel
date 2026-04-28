# UI build stage
FROM node:18.19.1-buster-slim AS umbrel-app-auth-ui-builder

# Set the working directory
WORKDIR /app

# Copy the package.json and package-lock.json
COPY packages/ui/package.json ./
COPY packages/ui/package-lock.json ./

# Install the dependencies
RUN npm ci

# Copy the rest of the files
COPY packages/ui/ .

# The ui-build stage only has 'packages/ui' in '/app', but the ui imports runtime values
# via a relative path ('../../../umbreld/source/modules/server/trpc/common') that resolves outside '/app'.
# We copy the target file to the expected path for the build to succeed.
COPY packages/umbreld/source/modules/server/trpc/common.ts /umbreld/source/modules/server/trpc/common.ts

# Build the app
RUN npm run app-auth:build

# Expose the port
EXPOSE 2003

# Start the app
CMD ["npm", "run", "app-auth:start"]

# Build Stage
FROM node:16-buster-slim AS umbrel-app-auth-builder

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
