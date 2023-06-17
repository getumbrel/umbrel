import express from 'express'
import asyncHandler from 'express-async-handler'
import { expressjwt } from "express-jwt"
import cors from 'cors'
import fse from 'fs-extra'

import isUmbrelHome from './utilities/is-umbrel-home.js'
import {findExternalUmbrelInstall, runPreMigrationChecks, migrateData, getMigrationStatus, unmountExternalDrives} from './utilities/migration.js'

const app = express()

// We need CORS so the dashboard can make requests to the umbreld server. We can't lock
// down to explicit domains because we don't know all potential domains ahead of time.
// This is safe to enable for now because everything is behind JWT auth and the JWT
// is stored in localstorage not a cookie so it won't be included in cross site
// requests. However this is only for the transition period from the legacy codebase
// to umbreld. We should migrate to serving everything from umbreld, then remove CORS
// and transmit the JWT in a cookie.
app.use(cors((request, callback) => callback(null, {origin: true, credentials: true})))

// Validate manager jwt
app.use(expressjwt({
  secret: () => fse.readFile(`${app.get('UMBREL_ROOT')}/jwt/jwt.key`),
  algorithms: ['RS256'],
  getToken: request => request.headers.authorization.split(' ')[1],
}))

app.get('/', (request, response) => {
  response.json({message: `there's no cloud, it's just someone else's computer ☂️`})
})

app.get('/is-umbrel-home', asyncHandler(async (request, response) => {
  response.json(await isUmbrelHome())
}))

app.get('/can-migrate', asyncHandler(async (request, response) => {
  const currentInstall = app.get('UMBREL_ROOT')
  const externalUmbrelInstall = await findExternalUmbrelInstall()
  await runPreMigrationChecks(currentInstall, externalUmbrelInstall)
  await unmountExternalDrives()

  response.json({success: true})
}))

app.get('/migration-status', asyncHandler(async (request, response) => {
  response.json(getMigrationStatus())
}))

app.post('/migrate', asyncHandler(async (request, response) => {
  const currentInstall = app.get('UMBREL_ROOT')
  const externalUmbrelInstall = await findExternalUmbrelInstall()
  await runPreMigrationChecks(currentInstall, externalUmbrelInstall)

  response.json({success: true})
  await migrateData(currentInstall, externalUmbrelInstall)
}))

app.use((error, request, response, next) => {
  console.error(error.stack)
  const statusCode = error.name === 'UnauthorizedError' ? 401 : 500
  response.status(statusCode).json({error: error.message})
})

export default app