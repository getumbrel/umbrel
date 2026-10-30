import {afterEach, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import App from './app.ts'

afterEach(() => {
	vi.useRealTimers()
})

function createApp() {
	const emit = vi.fn(async () => undefined)
	const umbreld = {
		dataDirectory: '/tmp/umbreld-app-progress',
		logger: {createChildLogger: () => ({log: vi.fn(), error: vi.fn()})},
		eventBus: {emit},
	} as unknown as Umbreld
	const app = new App(umbreld, 'test-app')
	app.state = 'installing'
	emit.mockClear()
	return {app, emit}
}

test('announces progress changes with the current state, at most every 250ms', () => {
	vi.useFakeTimers()
	const {app, emit} = createApp()

	app.stateProgress = 1
	expect(emit).toHaveBeenCalledTimes(1)
	expect(emit).toHaveBeenLastCalledWith('apps:progress', {appId: 'test-app', state: 'installing', progress: 1})

	// A burst of updates collapses into one trailing event with the latest values
	app.stateProgress = 1.5
	app.stateProgress = 2.3
	expect(emit).toHaveBeenCalledTimes(1)
	vi.advanceTimersByTime(250)
	expect(emit).toHaveBeenCalledTimes(2)
	expect(emit).toHaveBeenLastCalledWith('apps:progress', {appId: 'test-app', state: 'installing', progress: 2.3})
})

test('a trailing event reports the state at the time it fires', () => {
	vi.useFakeTimers()
	const {app, emit} = createApp()

	app.stateProgress = 98
	app.stateProgress = 99
	app.state = 'ready'
	vi.advanceTimersByTime(250)
	expect(emit).toHaveBeenLastCalledWith('apps:progress', {appId: 'test-app', state: 'ready', progress: 99})
})

test("doesn't announce progress that hasn't changed", () => {
	vi.useFakeTimers()
	const {app, emit} = createApp()

	app.stateProgress = 0
	vi.advanceTimersByTime(250)
	expect(emit).not.toHaveBeenCalled()
})

test('a removed app drops its pending progress event', () => {
	vi.useFakeTimers()
	const {app, emit} = createApp()

	app.stateProgress = 40
	app.stateProgress = 45.3
	app.cancelPendingProgressEvent()
	vi.advanceTimersByTime(250)
	expect(emit).toHaveBeenCalledTimes(1)
	expect(emit).toHaveBeenLastCalledWith('apps:progress', {appId: 'test-app', state: 'installing', progress: 40})
})
