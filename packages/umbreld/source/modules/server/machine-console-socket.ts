import type http from 'node:http'
import net from 'node:net'

import type {WebSocket} from 'ws'

import type Umbreld from '../../index.ts'
import type createLogger from '../utilities/logger.ts'
import type MachineConsoleSessions from './machine-console-sessions.ts'

export const CONSOLE_BACKPRESSURE_HIGH_WATER_BYTES = 1024 * 1024
export const CONSOLE_BACKPRESSURE_LOW_WATER_BYTES = 512 * 1024
export const MAX_BUFFERED_CONSOLE_BYTES = 8 * 1024 * 1024

export default function createMachineConsoleWebSocketHandler({
	umbreld,
	logger,
	sessions,
}: {
	umbreld: Umbreld
	logger: ReturnType<typeof createLogger>
	sessions: MachineConsoleSessions
}) {
	return async function (ws: WebSocket, request: http.IncomingMessage) {
		let display: net.Socket | undefined
		let machineId: string | undefined
		let sessionId: string | undefined
		let claimed = false
		let closed = false
		let displayPaused = false
		let pendingDisplayBytes = 0
		const cleanup = () => {
			if (closed) return
			closed = true
			if (claimed) {
				sessions.releaseConsole(machineId!, sessionId!, ws)
				claimed = false
			}
			display?.destroy()
		}
		// Register cleanup before the first await. A browser can disappear while
		// consoleSocket() is checking machine state; claiming the session after that
		// close would otherwise leak both the controller slot and display socket.
		ws.once('close', cleanup)
		try {
			const searchParams = new URL(`https://localhost${request.url}`).searchParams
			machineId = searchParams.get('machineId') ?? undefined
			sessionId = searchParams.get('sessionId') ?? undefined
			if (!machineId || !sessionId) throw new Error('Missing machineId or sessionId')
			const socketPath = await umbreld.machines.consoleSocket(machineId)
			if (closed) return
			sessions.claimConsole(machineId, sessionId, ws)
			claimed = true
			display = net.createConnection(socketPath)
			display.on('data', (data) => {
				if (closed || ws.readyState !== ws.OPEN) return
				if (pendingDisplayBytes + data.length > MAX_BUFFERED_CONSOLE_BYTES) {
					logger.error(`Machine console ${machineId}`, new Error('[machine-console-client-too-slow]'))
					cleanup()
					ws.terminate()
					return
				}

				pendingDisplayBytes += data.length
				if (!displayPaused && pendingDisplayBytes >= CONSOLE_BACKPRESSURE_HIGH_WATER_BYTES) {
					displayPaused = true
					display!.pause()
				}

				try {
					ws.send(data, {binary: true}, (error) => {
						pendingDisplayBytes = Math.max(0, pendingDisplayBytes - data.length)
						if (error) {
							logger.error(`Machine console ${machineId}`, error)
							cleanup()
							ws.terminate()
							return
						}
						if (!closed && displayPaused && pendingDisplayBytes <= CONSOLE_BACKPRESSURE_LOW_WATER_BYTES) {
							displayPaused = false
							display?.resume()
						}
					})
				} catch (error) {
					logger.error(`Machine console ${machineId}`, error)
					cleanup()
					ws.terminate()
				}
			})
			display.on('error', (error) => {
				logger.error(`Machine console ${machineId}`, error)
				ws.close()
			})
			display.on('close', () => ws.close())
			ws.on('message', (data) => display?.write(data as Buffer))
		} catch (error) {
			// Opening a console while the machine starts or stops is routine, and the
			// browser retries with backoff, so only unexpected failures are errors
			if (error instanceof Error && /\[machine-(not-running|console-unavailable)\]/.test(error.message)) {
				logger.verbose(`Machine console ${machineId}: ${error.message}`)
			} else {
				logger.error(`Machine console ${machineId}`, error)
			}
			cleanup()
			ws.close()
		}
	}
}
