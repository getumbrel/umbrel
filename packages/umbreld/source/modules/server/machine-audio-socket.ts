import {spawn} from 'node:child_process'
import fsp from 'node:fs/promises'
import type http from 'node:http'
import {setTimeout as delay} from 'node:timers/promises'

import type {WebSocket} from 'ws'

import type Umbreld from '../../index.ts'
import type createLogger from '../utilities/logger.ts'
import {MACHINE_CONSOLE_SUPERSEDED_CODE, type default as MachineConsoleSessions} from './machine-console-sessions.ts'

const MAX_BUFFERED_AUDIO_BYTES = 1024 * 1024

export function machineAudioPlaybackIsRunning(status: string) {
	return /^state:\s+RUNNING$/m.test(status)
}

async function waitForMachineAudioPlayback(ws: WebSocket, statusPath: string) {
	while (ws.readyState === ws.OPEN) {
		const status = await fsp.readFile(statusPath, 'utf8').catch(() => '')
		if (machineAudioPlaybackIsRunning(status)) return true
		await delay(50)
	}
	return false
}

export function machineAudioCaptureArguments(device: string) {
	return [
		'--quiet',
		'--device',
		device,
		'--file-type',
		'raw',
		'--format',
		'S16_LE',
		'--rate',
		'48000',
		'--channels',
		'2',
		'--buffer-time',
		'100000',
		'--period-time',
		'20000',
	] as const
}

export default function createMachineAudioWebSocketHandler({
	umbreld,
	logger,
	sessions,
}: {
	umbreld: Umbreld
	logger: ReturnType<typeof createLogger>
	sessions: MachineConsoleSessions
}) {
	return async function (ws: WebSocket, request: http.IncomingMessage) {
		let machineId: string | undefined
		let sessionId: string | undefined
		let capture: ReturnType<typeof spawn> | undefined
		ws.on('close', () => {
			if (machineId && sessionId) sessions.releaseAudio(machineId, sessionId, ws)
			capture?.kill()
		})
		try {
			const searchParams = new URL(`https://localhost${request.url}`).searchParams
			machineId = searchParams.get('machineId') ?? undefined
			sessionId = searchParams.get('sessionId') ?? undefined
			if (!machineId || !sessionId) throw new Error('Missing machineId or sessionId')
			// Audio belongs to the tab that controls the console, and attaching it
			// means the session closes it again on release or takeover. A tab that
			// lost the console is told so with the superseded code, which every
			// browser build treats as final rather than as a dropout to retry.
			if (!sessions.attachAudio(machineId, sessionId, ws)) {
				logger.verbose(`Machine audio ${machineId}: not the controlling console`)
				ws.close(MACHINE_CONSOLE_SUPERSEDED_CODE, 'Not the controlling console')
				return
			}
			const source = await umbreld.machines.audioCaptureSource(machineId).catch((error: Error) => {
				// No sound device (the legacy Windows profiles) or a machine on its
				// way down. Stay open and silent until the console goes, so there's
				// nothing for the browser to retry.
				if (/\[machine-(audio-unavailable|not-running)\]/.test(error.message)) {
					logger.verbose(`Machine audio ${machineId}: ${error.message}`)
					return undefined
				}
				throw error
			})
			if (!source || ws.readyState !== ws.OPEN) return
			// snd-aloop does not transition QEMU's playback side from SETUP to
			// RUNNING until its paired capture side is open. Start capture immediately
			// and drain its pre-roll, then forward only after playback is running so
			// the browser never receives the loopback device's long initial silence.
			let playbackReady = false
			capture = spawn('arecord', machineAudioCaptureArguments(source.device), {stdio: ['ignore', 'pipe', 'pipe']})
			if (ws.readyState !== ws.OPEN) capture.kill()
			capture.stdout!.on('data', (data: Buffer) => {
				if (playbackReady && ws.readyState === ws.OPEN && ws.bufferedAmount < MAX_BUFFERED_AUDIO_BYTES) {
					ws.send(data, {binary: true})
				}
			})
			capture.stderr!.on('data', (data: Buffer) =>
				logger.verbose(`Machine audio ${machineId}: ${data.toString().trim()}`),
			)
			capture.on('error', (error) => {
				logger.error(`Machine audio ${machineId}`, error)
				ws.close(1011)
			})
			capture.on('close', () => ws.close())
			playbackReady = await waitForMachineAudioPlayback(ws, source.playbackStatus)
			if (!playbackReady) capture.kill()
		} catch (error) {
			logger.error(`Machine audio ${machineId}`, error)
			capture?.kill()
			ws.close(1011)
		}
	}
}
