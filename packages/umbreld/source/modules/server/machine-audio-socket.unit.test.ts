import {EventEmitter} from 'node:events'

import {describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'

import createMachineAudioWebSocketHandler, {
	machineAudioCaptureArguments,
	machineAudioPlaybackIsRunning,
} from './machine-audio-socket.ts'
import MachineConsoleSessions, {MACHINE_CONSOLE_SUPERSEDED_CODE} from './machine-console-sessions.ts'

const childProcessMocks = vi.hoisted(() => ({spawn: vi.fn()}))

vi.mock('node:child_process', () => ({spawn: childProcessMocks.spawn}))

function fakeWebSocket() {
	const ws = new EventEmitter() as any
	ws.OPEN = 1
	ws.readyState = 1
	ws.close = vi.fn(() => (ws.readyState = 3))
	return ws
}

function audioHandler(audioCaptureSource: () => Promise<unknown>) {
	const sessions = new MachineConsoleSessions()
	const logger = {error: vi.fn(), verbose: vi.fn()}
	const handler = createMachineAudioWebSocketHandler({
		umbreld: {machines: {audioCaptureSource: vi.fn(audioCaptureSource)}} as unknown as Umbreld,
		logger: logger as any,
		sessions,
	})
	return {sessions, logger, handler}
}

const request = {url: '/?machineId=machine-1&sessionId=session-1'} as any

describe('machine audio capture', () => {
	test('captures browser-compatible raw 48 kHz stereo PCM from the allocated loopback substream', () => {
		expect(machineAudioCaptureArguments('hw:11,1,2')).toEqual([
			'--quiet',
			'--device',
			'hw:11,1,2',
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
		])
	})

	test('recognizes when capture pre-roll can begin forwarding guest playback', () => {
		expect(machineAudioPlaybackIsRunning('closed\n')).toBe(false)
		expect(machineAudioPlaybackIsRunning('state: SETUP\nowner_pid: 123\n')).toBe(false)
		expect(machineAudioPlaybackIsRunning('state: RUNNING\nowner_pid: 123\n')).toBe(true)
	})
})

describe('machine audio socket ownership', () => {
	test('turns away a tab without the console as final, without logging an error', async () => {
		const {logger, handler} = audioHandler(async () => ({device: 'hw:11,1,0', playbackStatus: '/status'}))
		const audio = fakeWebSocket()

		await handler(audio, request)

		// 4001 is the code every browser build stops retrying on
		expect(audio.close).toHaveBeenCalledWith(MACHINE_CONSOLE_SUPERSEDED_CODE, 'Not the controlling console')
		expect(logger.error).not.toHaveBeenCalled()
		expect(childProcessMocks.spawn).not.toHaveBeenCalled()
	})

	test('stays open and silent for a machine without a sound device, then closes with its console', async () => {
		const {sessions, logger, handler} = audioHandler(async () => {
			throw new Error('[machine-audio-unavailable]')
		})
		const console = fakeWebSocket()
		const audio = fakeWebSocket()
		sessions.claimConsole('machine-1', 'session-1', console)

		await handler(audio, request)

		expect(audio.close).not.toHaveBeenCalled()
		expect(logger.error).not.toHaveBeenCalled()
		expect(childProcessMocks.spawn).not.toHaveBeenCalled()

		sessions.releaseConsole('machine-1', 'session-1', console)
		expect(audio.close).toHaveBeenCalledWith(MACHINE_CONSOLE_SUPERSEDED_CODE, expect.any(String))
	})

	test('closes with an internal error code when capture cannot be set up', async () => {
		const {sessions, logger, handler} = audioHandler(async () => {
			throw new Error('unexpected')
		})
		const audio = fakeWebSocket()
		sessions.claimConsole('machine-1', 'session-1', fakeWebSocket())

		await handler(audio, request)

		expect(audio.close).toHaveBeenCalledWith(1011)
		expect(logger.error).toHaveBeenCalledOnce()
	})
})
