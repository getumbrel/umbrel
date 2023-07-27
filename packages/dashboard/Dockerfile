FROM node:14-buster-slim AS umbrel-dashboard-builder

ARG STAGING_DEPLOYMENT=false

# make the 'app' folder the current working directory
WORKDIR /app

# copy 'package.json'
COPY package.json ./

# copy 'yarn.lock'
COPY yarn.lock ./

# install dependencies
RUN yarn

# copy project files and folders to the current working directory (i.e. 'app' folder)
COPY . .

# build app for production
RUN yarn build

FROM node:14-buster-slim AS umbrel-dashboard

RUN yarn global add serve@13

COPY --from=umbrel-dashboard-builder /app/dist/ /dist

ENV PORT=3004
EXPOSE 3004

CMD [ "serve", "--single", "/dist" ]
