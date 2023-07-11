import path from 'node:path'
import http from 'node:http'
import {promisify} from 'node:util'

import getOrCreateFile from '../../utilities/get-or-create-file.js'
import randomToken from '../../utilities/random-token.js'

import UmbrelService from '../../services/umbrel-service.js'

import createHandler from './create-handler.js'

class Server extends UmbrelService {
	async start() {
		// Create the handler
		const {dataDirectory} = this.umbreld
		const sessionsPath = path.join(dataDirectory, 'sessions')
		const sessionSecretPath = path.join(dataDirectory, 'secrets/session-cookie-signing-secret')
		const sessionSecret = await getOrCreateFile(sessionSecretPath, randomToken(256))
		const handler = createHandler({
			umbreld: this.umbreld,
			sessionsPath,
			sessionSecret,
			logger: this.logger,
		})

		// Start the server
		const server = http.createServer(handler)
		const listen = promisify(server.listen.bind(server))
		await listen(this.umbreld.port)
		this.port = server.address().port
		this.logger.log(`Listening on port ${this.port}`)

		return this
	}
}

export default Server
