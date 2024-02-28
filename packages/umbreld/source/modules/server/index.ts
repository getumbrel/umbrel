import http from 'node:http'
import process from 'node:process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

import express from 'express'
import cors from 'cors'
import {createProxyMiddleware} from 'http-proxy-middleware'

import getOrCreateFile from '../utilities/get-or-create-file.js'
import randomToken from '../utilities/random-token.js'

import type Umbreld from '../../index.js'
import * as jwt from '../jwt.js'
import {trpcHandler} from './trpc/index.js'

export type ServerOptions = {umbreld: Umbreld}

class Server {
	umbreld: Umbreld
	logger: Umbreld['logger']
	port: number | undefined

	constructor({umbreld}: ServerOptions) {
		this.umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
	}

	async getJwtSecret() {
		const jwtSecretPath = `${this.umbreld.dataDirectory}/secrets/jwt`
		return getOrCreateFile(jwtSecretPath, randomToken(256))
	}

	async signToken() {
		return jwt.sign(await this.getJwtSecret())
	}

	async signProxyToken() {
		return jwt.signProxyToken(await this.getJwtSecret())
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

		// If we have no API route hits then serve the ui at the root.
		// We proxy through to the ui dev server during development with
		// process.env.UMBREL_UI_PROXY otherwise in production we
		// statically serve the built ui.
		if (process.env.UMBREL_UI_PROXY) {
			app.use(
				'/',
				createProxyMiddleware({
					target: process.env.UMBREL_UI_PROXY,
					ws: true,
					logProvider: () => ({
						log: this.logger.verbose,
						debug: this.logger.verbose,
						info: this.logger.verbose,
						warn: this.logger.verbose,
						error: this.logger.error,
					}),
				}),
			)
		} else {
			const currentFilename = fileURLToPath(import.meta.url)
			const currentDirname = dirname(currentFilename)
			const uiPath = join(currentDirname, '../../../ui')
			app.use('/', express.static(uiPath))
			app.use('*', express.static(`${uiPath}/index.html`))
		}

		// All errors should be handled by their own middleware but if they aren't we'll catch
		// them here and log them.
		app.use((error: Error, request: express.Request, response: express.Response, next: express.NextFunction): void => {
			this.logger.error(`${request.method} ${request.path} ${error.message}`)
			if (response.headersSent) return next(error)
			response.status(500).json({error: true})
		})

		// Start the server
		const server = http.createServer(app)
		const listen = promisify(server.listen.bind(server)) as (port: number) => Promise<void>
		await listen(this.umbreld.port)
		this.port = (server.address() as any).port
		this.logger.log(`Listening on port ${this.port}`)

		return this
	}
}

export default Server
