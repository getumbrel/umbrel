import {describe, expect, test} from 'vitest'

import {machineAudioCaptureArguments, machineAudioPlaybackIsRunning} from './machine-audio-socket.ts'

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
