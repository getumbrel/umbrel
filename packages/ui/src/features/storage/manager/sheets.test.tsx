// @vitest-environment jsdom
// A sheet that asks umbreld for something, through to umbreld's answer. In Settings the island
// shows the task starting the moment the request is sent, which changes the storage the sheet
// was opened for before umbreld has said yes or no.
import {act, useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {ImmersiveDialogProvider} from '@/providers/immersive-dialog'

import {Drive, TB} from '../model'
import type {StorageState} from '../state'
import {StorageManager} from './manager'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key, i18n: {language: 'en'}})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key, maybeT: (key: string) => key}))
// jsdom has no layout, and the window's scroll area asks to be told about it
vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
)
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const drive = (id: string, extra: Partial<Drive> = {}): Drive => ({
	id,
	kind: 'hdd',
	size: 8 * TB,
	model: 'Model',
	serial: id,
	smart: 'healthy',
	...extra,
})

// One-drive protection with a failed drive, and a new drive in to take its place
const before: StorageState = {
	device: 'other',
	drives: [drive('a'), drive('b', {smart: 'unhealthy'}), drive('c'), drive('spare')],
	pool: {
		kind: 'hdd',
		layout: 'raidz1',
		members: [
			{id: 'a', state: 'online'},
			{id: 'b', state: 'failed'},
			{id: 'c', state: 'online'},
		],
		accel: [],
		used: 0,
		dataErrors: 0,
		partialPairs: null,
	},
	op: null,
	failsafeError: null,
}

let host: HTMLDivElement
let root: Root
let answer: 'accept' | 'refuse'
let requests: number

function Settings() {
	const [state, setState] = useState(before)
	return (
		<StorageManager
			state={state}
			run={async () => {
				requests++
				// The island shows it starting before umbreld has answered
				setState({...before, op: {kind: 'rebuild', progress: 0}})
				await new Promise((resolve) => setTimeout(resolve, 500))
				if (answer === 'refuse') {
					setState(before)
					throw new Error('pool I/O is currently suspended')
				}
				setState({
					...before,
					pool: {
						...before.pool,
						members: before.pool.members.map((m) => (m.id === 'b' ? {id: 'spare', state: 'rebuilding'} : m)),
					},
					op: {kind: 'rebuild', progress: 1, memberId: 'spare'},
				})
			}}
			onClose={() => {}}
			onShutdown={() => {}}
			onRestart={() => {}}
			onOpenBackups={() => {}}
		/>
	)
}

beforeEach(() => {
	vi.useFakeTimers()
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
	answer = 'accept'
	requests = 0
})
afterEach(() => {
	act(() => root.unmount())
	host.remove()
	vi.useRealTimers()
})

const advance = (ms: number) =>
	act(async () => {
		await vi.advanceTimersByTimeAsync(ms)
	})
// Storage Manager's window is a dialog too: a sheet is the one that opens over it
const dialogs = () => [...document.querySelectorAll('[role="dialog"]')]
const windowText = () => dialogs()[0]?.textContent ?? ''
const sheet = () => (dialogs().length > 1 ? dialogs().at(-1)! : null)
const press = async (within: Element | null, label: string) => {
	const button = [...(within?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === label)
	expect(button, within?.textContent ?? 'nothing to press in').toBeTruthy()
	await act(async () => button!.click())
}

async function confirmReplace() {
	await act(async () =>
		root.render(
			<ImmersiveDialogProvider>
				<Settings />
			</ImmersiveDialogProvider>,
		),
	)
	await press(dialogs()[0], 'storage-mgr.action.replace.drive')
	expect(sheet()?.textContent).toContain('storage-mgr.replace.title.hdd')
	await press(sheet(), 'storage-mgr.action.replace.drive')
}

test('a sheet stays as it was confirmed until umbreld has answered', async () => {
	await confirmReplace()
	await advance(100)
	expect(requests).toBe(1)
	// The storage already reads as busy, and the sheet doesn't take that for someone else's task
	expect(windowText()).toContain('storage-mgr.status.rebuild.title')
	expect(sheet()?.textContent).toContain('storage-ui.starting')
	expect(sheet()?.textContent).not.toContain('storage-ui.blocked.busy')
})

test('a refusal is said in the sheet that asked, which can try again', async () => {
	answer = 'refuse'
	await confirmReplace()
	await advance(600)
	expect(sheet()?.textContent).toContain('storage-mgr.failed.replace')
	expect(sheet()?.textContent).toContain('pool I/O is currently suspended')
	// Nothing changed, and the same sheet asks again
	expect(windowText()).toContain('storage-mgr.status.broken.failed.hdd')
	answer = 'accept'
	await press(sheet(), 'try-again')
	await advance(600)
	expect(requests).toBe(2)
	expect(sheet()).toBeNull()
})

test('a sheet closes once umbreld has taken the request on', async () => {
	await confirmReplace()
	await advance(600)
	expect(sheet()).toBeNull()
	expect(windowText()).toContain('storage-mgr.status.rebuild.title')
})
