FROM node:18 as build

WORKDIR /app

# Cache dependencies for faster builds
COPY package.json package-lock.json .
RUN npm ci

# Build the binary
COPY . .
RUN npm run build -- --native

# Copy the binary to a blank image
FROM scratch
COPY --from=build /app/build/ /