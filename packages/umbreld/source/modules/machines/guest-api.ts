import http from 'node:http'

import express, {type ErrorRequestHandler, type RequestHandler} from 'express'

import type Umbreld from '../../index.ts'
import {machineIdPattern} from './machine-id.ts'

const tokenPattern = /^[0-9a-f]{64}$/
const firstBootBodyLimitBytes = 4 * 1024

type GuestApiOptions = {
	host: string
	port: number
	completeFirstBootSetup: (machineId: string, token: string) => Promise<unknown>
	logger: Pick<Umbreld['logger'], 'log' | 'error'>
}

export default class MachineGuestApi {
	#options: GuestApiOptions
	#server?: http.Server
	port?: number

	constructor(options: GuestApiOptions) {
		this.#options = options
	}

	async start() {
		if (this.#server) return
		const app = express()
		app.disable('x-powered-by')
		const validateFirstBootRoute: RequestHandler = (request, response, next) => {
			const {machineId, token} = request.params
			if (!machineIdPattern.test(machineId) || !tokenPattern.test(token)) return response.sendStatus(404)
			next()
		}
		const readFirstBootBody = express.raw({type: () => true, limit: firstBootBodyLimitBytes, inflate: false})
		app.post(
			'/api/machines/first-boot/:machineId/:token',
			validateFirstBootRoute,
			readFirstBootBody,
			async (request, response) => {
				const {machineId, token} = request.params
				try {
					await this.#options.completeFirstBootSetup(machineId, token)
					return response.sendStatus(204)
				} catch {
					return response.sendStatus(404)
				}
			},
		)
		app.use(((error, _request, response, next) => {
			if ((error as {type?: string}).type === 'entity.too.large') return response.sendStatus(413)
			next(error)
		}) as ErrorRequestHandler)
		app.use((_request, response) => response.sendStatus(404))

		const server = http.createServer(app)
		server.on('error', (error) => this.#options.logger.error('Machine guest API server error', error))
		server.requestTimeout = 10_000
		server.headersTimeout = 5_000
		server.keepAliveTimeout = 1_000
		try {
			await new Promise<void>((resolve, reject) => {
				const onError = (error: Error) => reject(error)
				server.once('error', onError)
				server.listen(this.#options.port, this.#options.host, () => {
					server.off('error', onError)
					resolve()
				})
			})
		} catch (error) {
			server.close()
			throw error
		}
		this.#server = server
		this.port = (server.address() as {port: number}).port
		this.#options.logger.log(`Machine guest API listening on ${this.#options.host}:${this.port}`)
	}

	async stop() {
		const server = this.#server
		if (!server) return
		this.#server = undefined
		this.port = undefined
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()))
			server.closeAllConnections()
		})
	}
}
