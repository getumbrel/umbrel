import http from 'node:http'
import {promisify} from 'node:util'

import express from 'express'

import getOrCreateFile from '../../utilities/get-or-create-file.js'
import randomToken from '../../utilities/random-token.js'

import UmbrelService from '../../services/umbrel-service.js'

import {trpcHandler} from '../../modules/trpc/index.js'
import * as jwt from '../../modules/jwt.js'

class Server extends UmbrelService {
	port: number | undefined

	async getJwtSecret() {
		const jwtSecretPath = `${this.umbreld.dataDirectory}/secrets/jwt`
		return getOrCreateFile(jwtSecretPath, randomToken(256))
	}

	async signToken() {
		return jwt.sign(await this.getJwtSecret())
	}

	async verifyToken(token: string) {
		return jwt.verify(token, await this.getJwtSecret())
	}

	async start() {
		// Ensure the JWT secret exists
		await this.getJwtSecret()

		// Create the handler
		const app = express()
		app.disable('x-powered-by')

		// TODO: Security hardening, helmet etc.

		// Attach the umbreld and logger instances so they're accessible to routes
		app.set('umbreld', this.umbreld)
		app.set('logger', this.logger)

		// Log requests
		app.use((request, response, next) => {
			this.logger.verbose(`${request.method} ${request.path}`)
			next()
		})

		// Handle tRPC routes
		app.use('/trpc', trpcHandler)

		// All errors should be handled by their own middleware but if they aren't we'll catch
		// them here and log them.
		app.use((error, request, response, next) => {
			this.logger.error(`${request.method} ${request.path} ${error.message}`)
			if (!response.headersSent) response.status(500).json({error: true})
		})

		// Start the server
		const server = http.createServer(app)
		const listen = promisify(server.listen.bind(server))
		await listen(this.umbreld.port)
		this.port = server.address().port
		this.logger.log(`Listening on port ${this.port}`)

		return this
	}
}

export default Server
