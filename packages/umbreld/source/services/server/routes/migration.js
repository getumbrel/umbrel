// Temporary place to port the existing server functionality to the umbreld codebase.
import express from 'express'
import asyncHandler from 'express-async-handler'
import {expressjwt} from 'express-jwt'
import cors from 'cors'
import fse from 'fs-extra'

import isUmbrelHome from '../../../modules/is-umbrel-home.js'
import {
	findExternalUmbrelInstall,
	runPreMigrationChecks,
	migrateData,
	getMigrationStatus,
	unmountExternalDrives,
} from '../../../modules/migration.js'

const router = new express.Router()
// We need CORS so the dashboard can make requests to the umbreld server. We can't lock
// down to explicit domains because we don't know all potential domains ahead of time.
// This is safe to enable for now because everything is behind JWT auth and the JWT
// is stored in localstorage not a cookie so it won't be included in cross site
// requests. However this is only for the transition period from the legacy codebase
// to umbreld. We should migrate to serving everything from umbreld, then remove CORS
// and transmit the JWT in a cookie.
router.use(cors((request, callback) => callback(null, {origin: true, credentials: true})))

// Validate manager jwt
router.use(
	expressjwt({
		secret: (request) => fse.readFile(`${request.app.get('umbreld').dataDirectory}/jwt/jwt.key`),
		algorithms: ['RS256'],
		getToken: (request) => request.headers.authorization.split(' ')[1],
	}),
)

router.get('/', (request, response) => {
	response.json({message: `there's no cloud, it's just someone else's computer ☂️`})
})

router.get(
	'/is-umbrel-home',
	asyncHandler(async (request, response) => {
		response.json(await isUmbrelHome())
	}),
)

router.get(
	'/can-migrate',
	asyncHandler(async (request, response) => {
		const currentInstall = request.app.get('umbreld').dataDirectory
		const externalUmbrelInstall = await findExternalUmbrelInstall()
		await runPreMigrationChecks(currentInstall, externalUmbrelInstall)
		await unmountExternalDrives()

		response.json({success: true})
	}),
)

router.get(
	'/migration-status',
	asyncHandler(async (request, response) => {
		response.json(getMigrationStatus())
	}),
)

router.post(
	'/migrate',
	asyncHandler(async (request, response) => {
		const currentInstall = request.app.get('umbreld').dataDirectory
		const externalUmbrelInstall = await findExternalUmbrelInstall()
		await runPreMigrationChecks(currentInstall, externalUmbrelInstall)

		response.json({success: true})
		await migrateData(currentInstall, externalUmbrelInstall)
	}),
)

// This error handler doesn't get correctly applied but lets not waste time fixing it
// since we'll move this to tRPC.
router.use((error, request, response) => {
	console.error(error.stack)
	const statusCode = error.name === 'UnauthorizedError' ? 401 : 500
	response.status(statusCode).json({error: error.message})
})

export default router
