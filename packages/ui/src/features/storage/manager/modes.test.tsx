// @vitest-environment jsdom
// The FailSafe sheet lists every mode umbrelOS has, on every kind of storage: the one in use, the
// ones that can be turned on, and the ones out of reach, each with the reason. This is what
// someone reads to learn what their Umbrel, and other Umbrels, can do, so the reasons are pinned.
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {ImmersiveDialogProvider} from '@/providers/immersive-dialog'

import {DeviceModel, Drive, DriveKind, Layout, TB} from '../model'
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

function storage(kind: DriveKind, layout: Layout, count: number, device: DeviceModel = 'other'): StorageState {
	const drives: Drive[] = Array.from({length: count}, (_, index) => ({
		id: `drive-${index}`,
		kind,
		size: 8 * TB,
		model: 'Model',
		serial: `serial-${index}`,
		smart: 'healthy',
		slot: device === 'pro' ? index + 1 : undefined,
	}))
	return {
		device,
		drives,
		pool: {
			kind,
			layout,
			members: drives.map((drive) => ({id: drive.id, state: 'online'})),
			accel: [],
			used: 0,
			dataErrors: 0,
			partialPairs: null,
		},
		op: null,
		failsafeError: null,
	}
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
})
afterEach(() => {
	act(() => root.unmount())
	host.remove()
})

// Storage Manager's window is a dialog too: the sheet is the one that opens over it
const dialogs = () => [...document.querySelectorAll('[role="dialog"]')]

type Mode = {text: string; chosen: boolean; disabled: boolean}

// Opens the FailSafe row's sheet and reads it: its words, and its modes in order
async function failsafeSheet(state: StorageState): Promise<{text: string; modes: Mode[]; readOnly: boolean}> {
	await act(async () =>
		root.render(
			<ImmersiveDialogProvider>
				<StorageManager
					state={state}
					run={async () => {}}
					onClose={() => {}}
					onShutdown={() => {}}
					onRestart={() => {}}
					onOpenBackups={() => {}}
				/>
			</ImmersiveDialogProvider>,
		),
	)
	const row = [...dialogs()[0].querySelectorAll('button')].find((button) =>
		button.textContent?.startsWith('storage-ui.failsafe'),
	)
	expect(row, 'the FailSafe row').toBeTruthy()
	await act(async () => row!.click())
	expect(dialogs().length).toBe(2)
	const sheet = dialogs().at(-1)!
	const group = sheet.querySelector('[role="radiogroup"]')
	return {
		text: sheet.textContent ?? '',
		readOnly: group?.getAttribute('aria-readonly') === 'true',
		modes: [...sheet.querySelectorAll<HTMLButtonElement>('[role="radio"]')].map((radio) => ({
			text: radio.textContent ?? '',
			chosen: radio.getAttribute('aria-checked') === 'true',
			// It can't be chosen, and says so, but can still be reached and read
			disabled: radio.getAttribute('aria-disabled') === 'true' && !radio.disabled,
		})),
	}
}

test('hard drives with FailSafe on: the mode in use, and the two that take starting over', async () => {
	const {text, modes, readOnly} = await failsafeSheet(storage('hdd', 'raidz2', 4))
	expect(readOnly).toBe(true)
	expect(modes.map((mode) => [mode.chosen, mode.disabled])).toEqual([
		[false, true],
		[true, false],
		[false, true],
	])
	const [oneDrive, twoDrive, pairs] = modes
	// The mode in use says what it costs and how it grows on this storage
	expect(twoDrive.text).toContain('RAID-Z2')
	expect(twoDrive.text).toContain('storage-ui.promise.raidz2.hdd')
	expect(twoDrive.text).toContain('storage-mgr.modes.yours.aside')
	expect(twoDrive.text).toContain('storage-mgr.modes.yours.grow.hdd')
	// The others say what they are in general, and why they can't be had from here
	expect(oneDrive.text).toContain('storage-mgr.modes.about.raidz1.hdd')
	expect(oneDrive.text).toContain('storage-mgr.modes.reset')
	expect(pairs.text).toContain('Mirror')
	expect(pairs.text).toContain('storage-mgr.modes.about.mirror')
	expect(pairs.text).toContain('storage-mgr.modes.reset')
	expect(text).toContain('storage-mgr.modes.note.switch')
	expect(text).not.toContain('storage-ui.problem.hdd-only')
	// Hard drives have three modes to weigh
	expect(text).toContain('storage-setup.compare')
})

test('one-drive protection that is full of hard drives grows by larger drives, not more of them', async () => {
	const {modes} = await failsafeSheet(storage('hdd', 'raidz1', 6))
	expect(modes[0].text).toContain('storage-mgr.modes.yours.grow.replace.hdd')
	expect((await failsafeSheet(storage('hdd', 'raidz1', 4))).modes[0].text).toContain(
		'storage-mgr.modes.yours.grow.hdd-limit',
	)
	expect((await failsafeSheet(storage('hdd', 'mirror', 4))).modes[2].text).toContain(
		'storage-mgr.modes.yours.grow.mirror',
	)
})

test('SSDs with FailSafe on: their one mode, and the two that take hard drives', async () => {
	const {text, modes, readOnly} = await failsafeSheet(storage('ssd', 'raidz1', 4, 'pro'))
	expect(readOnly).toBe(true)
	expect(modes.map((mode) => [mode.chosen, mode.disabled])).toEqual([
		[true, false],
		[false, true],
		[false, true],
	])
	expect(modes[0].text).toContain('storage-ui.promise.raidz1.ssd')
	// Umbrel Pro with every slot in use
	expect(modes[0].text).toContain('storage-mgr.modes.yours.grow.replace.ssd')
	for (const mode of modes.slice(1)) {
		expect(mode.text).toContain('storage-ui.problem.hdd-only')
		expect(mode.text).not.toContain('storage-mgr.modes.reset')
	}
	// The modes for hard drives are told about drives, not SSDs
	expect(modes[1].text).toContain('storage-ui.promise.raidz2.hdd')
	expect(modes[2].text).toContain('storage-ui.promise.mirror.hdd')
	expect(text).toContain('storage-mgr.modes.note.ssd-on')
	// One mode leaves nothing to compare
	expect(text).not.toContain('storage-setup.compare')
	// With a slot free, an SSD can simply be added
	expect((await failsafeSheet(storage('ssd', 'raidz1', 3, 'pro'))).modes[0].text).toContain(
		'storage-mgr.modes.yours.grow.ssd',
	)
})

test('one SSD in Full Storage: its mode can be turned on, the other two are still listed', async () => {
	const {text, modes, readOnly} = await failsafeSheet(storage('ssd', 'stripe', 1, 'pro'))
	expect(readOnly).toBe(false)
	expect(modes.length).toBe(3)
	// No second SSD is connected yet
	expect(modes[0].text).toContain('storage-mgr.not-yet')
	expect(modes[1].text).toContain('storage-ui.problem.hdd-only')
	expect(modes[2].text).toContain('storage-ui.problem.hdd-only')
	expect(text).toContain('storage-mgr.modes.note.ssd')
})

test('several hard drives in Full Storage: only pairs can be turned on, and the sheet says why', async () => {
	const {text, modes} = await failsafeSheet(storage('hdd', 'stripe', 3))
	expect(modes[0].text).toContain('storage-mgr.modes.reset')
	expect(modes[1].text).toContain('storage-mgr.modes.reset')
	expect(modes[2].text).toContain('storage-mgr.not-yet')
	expect(text).toContain('storage-mgr.modes.note.pairs-only')
})

test('several SSDs in Full Storage: no mode can be turned on, and each one says what it would take', async () => {
	const {text, modes, readOnly} = await failsafeSheet(storage('ssd', 'stripe', 2, 'pro'))
	expect(text).toContain('storage-mgr.failsafe.impossible.title')
	expect(readOnly).toBe(true)
	expect(modes.every((mode) => mode.disabled && !mode.chosen)).toBe(true)
	expect(modes[0].text).toContain('storage-mgr.modes.reset')
	expect(modes[0].text).toContain('storage-mgr.modes.about.raidz1.ssd')
	expect(modes[1].text).toContain('storage-ui.problem.hdd-only')
	expect(modes[2].text).toContain('storage-ui.problem.hdd-only')
	expect(text).toContain('storage-mgr.modes.note.ssd')
})

test('Umbrel Pro with a new SSD waiting in its last slot grows by adding it, not by larger SSDs', async () => {
	const state = storage('ssd', 'raidz1', 3, 'pro')
	state.drives.push({id: 'new', kind: 'ssd', size: 8 * TB, model: 'Model', serial: 'new', smart: 'healthy', slot: 4})
	const {modes} = await failsafeSheet(state)
	expect(modes[0].text).toContain('storage-mgr.modes.yours.grow.ssd')
	expect(modes[0].text).not.toContain('storage-mgr.modes.yours.grow.replace.ssd')
})
