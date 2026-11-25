// Storage lab: pretend hardware, and every scenario the index page lists. Onboarding
// scenarios are a machine and its drives. Storage Manager scenarios are a storage in some
// state, in the same shape the real one gets from umbreld.

import {DeviceModel, Drive, DriveKind, GB, Hardware, Layout, placeMissing, Setup, TB} from '@/features/storage/model'
import {Member, Operation, StorageState, viewPool} from '@/features/storage/state'

// ---------------------------------------------------------------------------
// Pretend drives
// ---------------------------------------------------------------------------

const hddModels = ['WD Red Plus', 'Seagate IronWolf', 'Toshiba N300', 'WD Red Pro', 'Seagate Exos', 'WD Gold']
const ssdModels = [
	'Samsung 990 PRO',
	'WD_BLACK SN850X',
	'Crucial T500',
	'Kingston KC3000',
	'SK hynix P41',
	'Lexar NM790',
]

let serialCounter = 0
export function makeDrive(kind: DriveKind, sizeTb: number, extra: Partial<Drive> = {}): Drive {
	serialCounter += 1
	const index = serialCounter
	const models = kind === 'hdd' ? hddModels : ssdModels
	const serial = `${kind === 'hdd' ? 'ZR' : 'S7'}${(index * 7919 + 104729).toString(36).toUpperCase().slice(0, 6)}`
	const model = models[index % models.length]
	return {
		// The name umbreld knows a drive by: its model and serial number, and for NVMe its namespace
		id: `${model.replaceAll(' ', '_')}_${serial}${kind === 'ssd' ? '_1' : ''}`,
		kind,
		size: sizeTb * TB,
		model,
		serial,
		smart: 'healthy',
		// What an NVMe SSD reports about itself. A hard drive reports its temperature and nothing else.
		...(kind === 'ssd'
			? {temperature: 38 + (index % 6), temperatureWarning: 82, temperatureCritical: 90, lifetimeUsed: 2 + (index % 5)}
			: {temperature: 33 + (index % 5)}),
		...extra,
	}
}

// What can be wrong with a drive that still works, as the lab switches it on
export const conditions = {
	failing: {smart: 'unhealthy'},
	unknown: {smart: 'unknown'},
	worn: {lifetimeUsed: 91},
	hot: {temperature: 84},
	critical: {temperature: 93},
	errors: {errors: 14},
	faulty: {degraded: true, errors: 212},
} satisfies Record<string, Partial<Drive>>

// A compact way to describe a machine, for scenario links and the "build your own" form:
//   nas:h8,h8,h8,h2,s1,s1   a machine with four hard drives (8, 8, 8 and 2TB) and two 1TB SSDs
//   pro:s2,_,s4             an Umbrel Pro with SSDs in slots 1 and 3
// After the size: ! fails its health check, ? doesn't report its health, w is a worn SSD,
// t runs hot, c is far too hot, e has reported errors, a is a SATA SSD (reports no wear or
// limits), b is the drive umbrelOS starts from.
// A trailing @earlier says an earlier Umbrel setup is on the drives.
export function parseHardware(spec: string): {hardware: Hardware; earlierSetup: boolean} {
	const [machine, flags = ''] = spec.split('@')
	const [deviceText, driveText = ''] = machine.split(':')
	const device: DeviceModel = deviceText === 'pro' ? 'pro' : 'other'
	const drives: Drive[] = []
	let slot = 0
	for (const token of driveText.split(',').filter(Boolean)) {
		slot += 1
		const match = /^([hs])(\d+(?:\.\d+)?)([!?wtceab]*)$/.exec(token.trim())
		if (!match) continue
		const kind: DriveKind = match[1] === 'h' ? 'hdd' : 'ssd'
		if (device === 'pro' && (kind === 'hdd' || slot > 4)) continue
		const marks = match[3]
		const drive = makeDrive(kind, Number(match[2]), {slot: device === 'pro' ? slot : undefined})
		const sata = marks.includes('a')
		drives.push({
			...drive,
			...(sata ? {temperatureWarning: undefined, temperatureCritical: undefined, lifetimeUsed: undefined} : {}),
			...(marks.includes('!') ? conditions.failing : {}),
			...(marks.includes('?') ? conditions.unknown : {}),
			...(marks.includes('w') ? conditions.worn : {}),
			...(marks.includes('t') ? conditions.hot : {}),
			...(marks.includes('c') ? conditions.critical : {}),
			...(marks.includes('e') ? conditions.errors : {}),
			...(marks.includes('b') ? {system: true} : {}),
		})
	}
	return {hardware: {device, drives}, earlierSetup: flags.includes('earlier')}
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export type OnboardingScenario = {
	id: string
	group: string
	title: string
	note: string
	// See parseHardware for the format
	hardware: string
}

export const onboardingScenarios: OnboardingScenario[] = [
	// Umbrel Pro
	{
		id: 'pro-1',
		group: 'Umbrel Pro',
		title: 'One SSD',
		note: 'FailSafe isn’t possible yet. Says how to get it later.',
		hardware: 'pro:s2',
	},
	{
		id: 'pro-2',
		group: 'Umbrel Pro',
		title: 'Two matching SSDs',
		note: 'The simplest FailSafe: one screen, one button.',
		hardware: 'pro:s2,s2',
	},
	{id: 'pro-4', group: 'Umbrel Pro', title: 'Four matching SSDs', note: 'A full tray.', hardware: 'pro:s4,s4,s4,s4'},
	{
		id: 'pro-gaps',
		group: 'Umbrel Pro',
		title: 'SSDs in slots 1 and 3',
		note: 'The picture follows the slots, not the list.',
		hardware: 'pro:s2,_,s2',
	},
	{
		id: 'pro-mixed',
		group: 'Umbrel Pro',
		title: 'Mixed sizes: 2TB, 2TB, 4TB',
		note: 'Full Storage is the default, as today. FailSafe shows what it would leave unusable.',
		hardware: 'pro:s2,s2,s4',
	},
	{
		id: 'pro-small-one',
		group: 'Umbrel Pro',
		title: 'One small SSD: 1TB with three 4TB',
		note: 'FailSafe leaves the 1TB out, because using it would shrink the others.',
		hardware: 'pro:s1,s4,s4,s4',
	},
	{
		id: 'pro-failing',
		group: 'Umbrel Pro',
		title: 'An SSD failing its health check',
		note: 'Left out by default, with the reason on the SSD. It keeps its warning mark.',
		hardware: 'pro:s2,s2!,s2',
	},
	{
		id: 'pro-only-failing',
		group: 'Umbrel Pro',
		title: 'The only SSD is failing its health check',
		note: 'Set up anyway, with a clear warning.',
		hardware: 'pro:s2!',
	},
	{
		id: 'pro-worn',
		group: 'Umbrel Pro',
		title: 'A worn SSD',
		note: 'Still used, with a warning: wear is not failure.',
		hardware: 'pro:s2,s2w',
	},
	{
		id: 'pro-restore',
		group: 'Umbrel Pro',
		title: 'SSDs from an earlier Umbrel setup',
		note: 'Offers to restore it. Setting up as new erases it once, at the usual confirmation.',
		hardware: 'pro:s2,s2@earlier',
	},
	{id: 'pro-none', group: 'Umbrel Pro', title: 'No SSDs installed', note: 'Nothing to set up yet.', hardware: 'pro:'},

	// Hard drives
	{
		id: 'nas-1',
		group: 'Hard drives',
		title: 'One hard drive',
		note: 'Full Storage only, and how FailSafe comes later.',
		hardware: 'nas:h8',
	},
	{
		id: 'nas-2',
		group: 'Hard drives',
		title: 'Two matching hard drives',
		note: 'A mirrored pair is recommended, as umbreld’s own default is.',
		hardware: 'nas:h8,h8',
	},
	{
		id: 'nas-3',
		group: 'Hard drives',
		title: 'Three hard drives',
		note: 'An odd number: mirrored pairs would leave one out.',
		hardware: 'nas:h8,h8,h8',
	},
	{
		id: 'nas-4',
		group: 'Hard drives',
		title: 'Four hard drives',
		note: 'All three FailSafe levels are possible.',
		hardware: 'nas:h8,h8,h8,h8',
	},
	{
		id: 'nas-6',
		group: 'Hard drives',
		title: 'Six hard drives',
		note: 'Two-drive protection becomes the recommendation.',
		hardware: 'nas:h12,h12,h12,h12,h12,h12',
	},
	{
		id: 'nas-8',
		group: 'Hard drives',
		title: 'Eight hard drives',
		note: 'One-drive protection stops at six drives, and says how many it uses.',
		hardware: 'nas:h16,h16,h16,h16,h16,h16,h16,h16',
	},
	{
		id: 'nas-12',
		group: 'Hard drives',
		title: 'Twelve hard drives',
		note: 'Counts stay numerals, and the bay scrolls.',
		hardware: 'nas:h16,h16,h16,h16,h16,h16,h16,h16,h16,h16,h16,h16',
	},
	{
		id: 'nas-boot',
		group: 'Hard drives',
		title: 'Four hard drives and a boot drive',
		note: 'The drive umbrelOS runs from is accounted for, and never offered.',
		hardware: 'nas:s0.25b,h8,h8,h8,h8',
	},

	// Size mismatches
	{
		id: 'nas-small-one',
		group: 'Mismatched drives',
		title: 'Three 8TB and one 2TB',
		note: 'Full Storage by default. With FailSafe the 2TB is left out: with it, storage would fall from 16TB to 6TB.',
		hardware: 'nas:h8,h8,h8,h2',
	},
	{
		id: 'nas-pairs',
		group: 'Mismatched drives',
		title: 'Two 4TB and two 16TB',
		note: 'Mirrored pairs waste nothing here, so FailSafe is recommended.',
		hardware: 'nas:h4,h4,h16,h16',
	},
	{
		id: 'nas-all-different',
		group: 'Mismatched drives',
		title: 'Four different sizes',
		note: '4, 8, 12 and 16TB: the hardest case to explain.',
		hardware: 'nas:h4,h8,h12,h16',
	},
	{
		id: 'nas-failing',
		group: 'Mismatched drives',
		title: 'A hard drive failing its health check',
		note: 'Left out by default. Including it shows a warning.',
		hardware: 'nas:h8,h8,h8,h8!',
	},
	{
		id: 'nas-unknown-health',
		group: 'Mismatched drives',
		title: 'A hard drive that doesn’t report its health',
		note: 'Used, and shown as Unknown rather than Healthy.',
		hardware: 'nas:h8,h8,h8?',
	},

	// Hard drives with SSDs
	{
		id: 'nas-accel',
		group: 'Hard drives with SSDs',
		title: 'Four hard drives, two SSDs',
		note: 'Hard drives hold the files by default. SSDs can be chosen instead.',
		hardware: 'nas:h8,h8,h8,h8,s1,s1',
	},
	{
		id: 'nas-accel-one',
		group: 'Hard drives with SSDs',
		title: 'Four hard drives, one SSD',
		note: 'FailSafe needs two SSDs for acceleration. Full Storage can use the one.',
		hardware: 'nas:h8,h8,h8,h8,s1',
	},
	{
		id: 'nas-accel-mismatch',
		group: 'Hard drives with SSDs',
		title: 'Two hard drives, a 1TB and a 2TB SSD',
		note: 'A mismatched acceleration pair.',
		hardware: 'nas:h8,h8,s1,s2',
	},
	{
		id: 'nas-accel-three',
		group: 'Hard drives with SSDs',
		title: 'Four hard drives, three SSDs',
		note: 'Two are used, and you choose which.',
		hardware: 'nas:h8,h8,h8,h8,s1,s1,s2',
	},
	{
		id: 'nas-one-and-ssd',
		group: 'Hard drives with SSDs',
		title: 'One hard drive, one SSD',
		note: 'Full Storage with acceleration.',
		hardware: 'nas:h12,s1',
	},
	{
		id: 'nas-mostly-ssd',
		group: 'Hard drives with SSDs',
		title: 'One hard drive, four SSDs',
		note: 'The hard drive holds the files unless you choose the SSDs.',
		hardware: 'nas:h8,s2,s2,s2,s2',
	},

	// SSDs on other hardware
	{
		id: 'flash-2',
		group: 'SSDs on other hardware',
		title: 'Two SSDs',
		note: 'The same flow as Umbrel Pro, without the tray.',
		hardware: 'nas:s2,s2',
	},
	{
		id: 'flash-6',
		group: 'SSDs on other hardware',
		title: 'Six SSDs',
		note: 'An all-flash machine.',
		hardware: 'nas:s4,s4,s4,s4,s4,s4',
	},
	{
		id: 'flash-sata',
		group: 'SSDs on other hardware',
		title: 'Two SATA SSDs',
		note: 'They report no wear or temperature limits, so none are shown.',
		hardware: 'nas:s2a,s2a',
	},
	{
		id: 'flash-failing',
		group: 'SSDs on other hardware',
		title: 'Two SSDs, both failing their health check',
		note: 'Nothing else to use, so they are used with a warning.',
		hardware: 'nas:s2!,s2!',
	},

	// Other starts
	{
		id: 'nas-restore',
		group: 'Other starts',
		title: 'Hard drives from an earlier Umbrel setup',
		note: 'Offers to restore it before anything is erased.',
		hardware: 'nas:h8,h8,h8@earlier',
	},
]

// ---------------------------------------------------------------------------
// Storage Manager
// ---------------------------------------------------------------------------

type Ids = {members: string[]; accel: string[]; loose: string[]}

type PoolSpec = {
	device?: DeviceModel
	layout: Layout
	// Drive lists in parseHardware's token format: 'h8,h8,h8'. Mirrored layouts keep the two
	// drives of a pair next to each other.
	members: string
	accel?: string
	loose?: string
	// The drive umbrelOS runs from, on other hardware
	system?: string
	// How full the storage is, 0 to 1
	used?: number
	// Member positions, counted from 0
	failed?: number[]
	missing?: number[]
	unusable?: number[]
	accelFailed?: number[]
	// Members reporting trouble while still working
	trouble?: Partial<Record<keyof typeof conditions, number[]>>
	dataErrors?: number
	// Member positions that got their pair before a switch to FailSafe stopped
	partial?: [number, number][]
	accelUsed?: number
	failsafeError?: string
	finished?: Exclude<Operation['kind'], 'check'>
	op?: (ids: Ids) => Operation
	// Marks the last member as still being added, for an expansion in progress
	joining?: boolean
	// Marks a member as being rebuilt
	rebuilding?: number
	usb?: boolean
}

function drivesFor(device: DeviceModel, tokens: string | undefined, firstSlot: number): Drive[] {
	if (!tokens) return []
	const {drives} = parseHardware(`nas:${tokens}`).hardware
	return device === 'pro' ? drives.map((drive, index) => ({...drive, slot: firstSlot + index})) : drives
}

export const usbDrives = [
	{id: 'usb-1', name: 'Samsung T7', size: 2 * TB},
	{id: 'usb-2', name: 'Backups', detail: 'SanDisk Extreme', size: 1 * TB},
]

export function buildState(spec: PoolSpec): StorageState {
	const device = spec.device ?? 'other'
	const memberDrives = drivesFor(device, spec.members, 1)
	const accelDrives = drivesFor('other', spec.accel, 1)
	const looseDrives = drivesFor(device, spec.loose, memberDrives.length + 1)
	const systemDrives = drivesFor('other', spec.system, 1).map((drive) => ({...drive, system: true}))
	const kind: DriveKind = memberDrives[0]?.kind ?? 'hdd'

	const members: Member[] = memberDrives.map((drive, index) => ({
		id: drive.id,
		state: spec.failed?.includes(index)
			? 'failed'
			: spec.missing?.includes(index)
				? 'missing'
				: spec.unusable?.includes(index)
					? 'unusable'
					: spec.rebuilding === index
						? 'rebuilding'
						: spec.joining && index === memberDrives.length - 1
							? 'joining'
							: 'online',
	}))
	const accel: Member[] = accelDrives.map((drive, index) => ({
		id: drive.id,
		state: spec.accelFailed?.includes(index) ? 'failed' : 'online',
	}))
	const drives = [...memberDrives, ...accelDrives, ...looseDrives, ...systemDrives].map((drive): Drive => {
		const memberIndex = memberDrives.indexOf(drive)
		const accelIndex = accelDrives.indexOf(drive)
		if (spec.missing?.includes(memberIndex)) return {...drive, absent: true}
		if (spec.failed?.includes(memberIndex) || spec.accelFailed?.includes(accelIndex))
			return {...drive, ...conditions.failing}
		let troubled = drive
		for (const [condition, positions] of Object.entries(spec.trouble ?? {})) {
			if (positions.includes(memberIndex)) troubled = {...troubled, ...conditions[condition as keyof typeof conditions]}
		}
		return troubled
	})

	const state: StorageState = {
		device,
		// umbreld only knows which slot an SSD is in while it can see the SSD
		drives: device === 'pro' ? placeMissing(drives) : drives,
		pool: {
			kind,
			layout: spec.layout,
			members,
			accel,
			used: 0,
			dataErrors: spec.dataErrors ?? 0,
			partialPairs: spec.partial?.map(([a, b]): [string, string] => [memberDrives[a].id, memberDrives[b].id]) ?? null,
			accelRoom: accelDrives.length > 0 ? Math.min(...accelDrives.map((drive) => drive.size)) * 0.5 : undefined,
			accelUsed: accelDrives.length > 0 ? (spec.accelUsed ?? 0.06) : undefined,
		},
		op:
			spec.op?.({
				members: memberDrives.map((drive) => drive.id),
				accel: accelDrives.map((drive) => drive.id),
				loose: looseDrives.map((drive) => drive.id),
			}) ?? null,
		failsafeError: spec.failsafeError ?? null,
		finished: spec.finished ? {kind: spec.finished, at: Date.now() - 4 * 60_000} : null,
	}
	state.pool.used = viewPool(state).capacity.usable * (spec.used ?? 0.38)
	return state
}

// Carries a finished onboarding straight into the Storage Manager mock
export function stateFromSetup(device: DeviceModel, setup: Setup, allDrives: Drive[]): StorageState {
	const inUse = new Set(setup.erased.map((drive) => drive.id))
	const ordered =
		setup.layout === 'mirror'
			? setup.capacity.pairs.flatMap(([a, b]) => [a, b]).map((id) => setup.selected.find((drive) => drive.id === id)!)
			: setup.selected
	const accel = setup.accel.chosen
	return {
		device,
		drives: [...ordered, ...accel, ...allDrives.filter((drive) => !inUse.has(drive.id))],
		pool: {
			kind: setup.kind,
			layout: setup.layout,
			members: ordered.map((drive) => ({id: drive.id, state: 'online'})),
			accel: accel.map((drive) => ({id: drive.id, state: 'online'})),
			used: 12 * GB,
			dataErrors: 0,
			partialPairs: null,
			accelRoom: accel.length > 0 ? Math.min(...accel.map((drive) => drive.size)) * 0.5 : undefined,
			accelUsed: accel.length > 0 ? 0.01 : undefined,
		},
		op: null,
		failsafeError: null,
		finished: null,
	}
}

export type ManagerScenario = {
	id: string
	group: string
	title: string
	note: string
	usb?: boolean
	build: () => StorageState
}

const scenario = (id: string, group: string, title: string, note: string, spec: PoolSpec): ManagerScenario => ({
	id,
	group,
	title,
	note,
	usb: spec.usb,
	build: () => buildState(spec),
})

const everyday = 'Everyday'
const attention = 'A drive needs attention'
const progress = 'Work in progress'
const adding = 'A new drive'
const swapping = 'Swapping a working drive'
const limits = 'Limits, explained'

export const managerScenarios: ManagerScenario[] = [
	// Everyday
	scenario('pro-failsafe', everyday, 'Umbrel Pro · FailSafe, four SSDs', 'The view most people see.', {
		device: 'pro',
		layout: 'raidz1',
		members: 's4,s4,s4,s4',
		used: 0.42,
		usb: true,
	}),
	scenario('pro-one', everyday, 'Umbrel Pro · one SSD, Full Storage', 'Three empty slots and a way to FailSafe.', {
		device: 'pro',
		layout: 'stripe',
		members: 's2',
		used: 0.3,
	}),
	scenario('nas-one', everyday, 'Hard drives · one drive, Full Storage', 'Every FailSafe Mode is still open to it.', {
		layout: 'stripe',
		members: 'h8',
		used: 0.2,
	}),
	scenario('nas-z1', everyday, 'Hard drives · one-drive protection', 'Four 8TB drives.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8',
	}),
	scenario('nas-z2', everyday, 'Hard drives · two-drive protection', 'Six 12TB drives.', {
		layout: 'raidz2',
		members: 'h12,h12,h12,h12,h12,h12',
		used: 0.51,
	}),
	scenario('nas-mirror', everyday, 'Hard drives · mirrored pairs', 'An 8TB pair and a 4TB pair.', {
		layout: 'mirror',
		members: 'h8,h8,h4,h4',
	}),
	scenario('nas-accel', everyday, 'Hard drives · SSD Acceleration', 'FailSafe with a pair of SSDs.', {
		layout: 'raidz2',
		members: 'h8,h8,h8,h8',
		accel: 's1,s1',
	}),
	scenario('nas-full', everyday, 'Hard drives · Full Storage, three drives', 'No protection, said plainly.', {
		layout: 'stripe',
		members: 'h8,h8,h4',
	}),
	scenario('nas-full-accel', everyday, 'Hard drives · Full Storage with one SSD', 'Acceleration on a single SSD.', {
		layout: 'stripe',
		members: 'h12,h12',
		accel: 's1',
	}),
	scenario('flash-z1', everyday, 'SSDs on other hardware · FailSafe', 'Six SSDs, no tray to draw.', {
		layout: 'raidz1',
		members: 's4,s4,s4,s4,s4,s4',
		used: 0.2,
	}),
	scenario('nas-boot', everyday, 'Other hardware with a boot drive', 'The boot drive is listed, apart from storage.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8',
		system: 's0.25',
	}),
	scenario('nas-nearly-full', everyday, 'Storage is almost full', 'More than a coloured bar: what to do about it.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8',
		used: 0.94,
	}),

	// A drive needs attention
	scenario('pro-failed', attention, 'Umbrel Pro · an SSD has failed', 'At risk, with every slot full.', {
		device: 'pro',
		layout: 'raidz1',
		members: 's4,s4,s4,s4',
		failed: [2],
	}),
	scenario(
		'pro-failed-spare',
		attention,
		'Umbrel Pro · failed SSD, new SSD in',
		'One button to replace it. Follow it through the rebuild.',
		{device: 'pro', layout: 'raidz1', members: 's4,s4,s4', loose: 's4', failed: [1]},
	),
	scenario('nas-z1-failed', attention, 'One-drive protection · a drive has failed', 'Nothing protects the data now.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8',
		failed: [1],
	}),
	scenario(
		'nas-z2-failed',
		attention,
		'Two-drive protection · a drive has failed',
		'Still protected against one more. Calmer than the case above.',
		{layout: 'raidz2', members: 'h12,h12,h12,h12,h12,h12', failed: [3], used: 0.51},
	),
	scenario(
		'nas-z2-two',
		attention,
		'Two-drive protection · two drives have failed',
		'Now at risk. Replaced one at a time.',
		{layout: 'raidz2', members: 'h12,h12,h12,h12,h12,h12', failed: [1, 3], used: 0.51},
	),
	scenario('nas-mirror-failed', attention, 'Mirrored pairs · a paired drive has failed', 'One pair is unprotected.', {
		layout: 'mirror',
		members: 'h8,h8,h4,h4',
		failed: [1],
		loose: 'h8',
	}),
	scenario('nas-missing', attention, 'A drive is not detected', 'Pulled out or disconnected, not failed.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8',
		missing: [2],
	}),
	scenario('pro-missing', attention, 'Umbrel Pro · an SSD is not detected', 'Which slot it was in can’t be known.', {
		device: 'pro',
		layout: 'raidz1',
		members: 's4,s4,s4',
		missing: [1],
	}),
	scenario(
		'nas-unusable',
		attention,
		'A drive is connected but can’t be used',
		'Repaired where it is, without a new drive.',
		{layout: 'raidz1', members: 'h8,h8,h8,h8', unusable: [3]},
	),
	scenario(
		'nas-unusable-spare',
		attention,
		'A drive can’t be used, and a new one is in',
		'The new drive is the better home for the data, so it is offered first.',
		{layout: 'raidz1', members: 'h8,h8,h8,h8', unusable: [3], loose: 'h8'},
	),
	scenario(
		'nas-failed-last-resort',
		attention,
		'A drive has failed, and the only new drive is failing too',
		'Offered as a last resort, and said plainly.',
		{layout: 'raidz1', members: 'h8,h8,h8,h8', failed: [1], loose: 'h8!'},
	),
	scenario(
		'nas-failed-risky',
		attention,
		'A drive has failed, and another may fail soon',
		'The failed drive stays connected for as long as it can.',
		{layout: 'raidz1', members: 'h8,h8,h8,h8', failed: [1], trouble: {failing: [2]}},
	),
	scenario(
		'nas-failed-smaller',
		attention,
		'The largest drive has failed, and a smaller new one is in',
		'A replacement only has to match the smallest drive.',
		{layout: 'raidz1', members: 'h4,h4,h8', failed: [2], loose: 'h4'},
	),
	scenario('nas-warning', attention, 'A drive may fail soon', 'Still working, but failing its health check.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8',
		trouble: {failing: [0]},
	}),
	scenario(
		'nas-faulty',
		attention,
		'A drive has too many errors',
		'Still in use, but your storage no longer trusts it.',
		{
			layout: 'raidz1',
			members: 'h8,h8,h8,h8',
			trouble: {faulty: [1]},
		},
	),
	scenario('nas-errors', attention, 'A drive is reporting errors', 'Working, but your storage has seen errors on it.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8',
		trouble: {errors: [2]},
	}),
	scenario('pro-hot', attention, 'Umbrel Pro · an SSD is running hot', 'A warning with something to do about it.', {
		device: 'pro',
		layout: 'raidz1',
		members: 's4,s4,s4,s4',
		trouble: {hot: [1]},
	}),
	scenario(
		'pro-critical',
		attention,
		'Umbrel Pro · an SSD is far too hot',
		'Over its critical limit: a level above hot.',
		{
			device: 'pro',
			layout: 'raidz1',
			members: 's4,s4,s4,s4',
			trouble: {critical: [2]},
		},
	),
	scenario(
		'pro-worn',
		attention,
		'Umbrel Pro · an SSD is nearly worn out',
		'Time to plan a swap, with a slot free for it.',
		{
			device: 'pro',
			layout: 'raidz1',
			members: 's4,s4,s4',
			trouble: {worn: [0]},
		},
	),
	scenario('nas-accel-failed', attention, 'An acceleration SSD has failed', 'The other SSD holds the only copy.', {
		layout: 'raidz2',
		members: 'h12,h12,h12,h12',
		accel: 's1,s1',
		accelFailed: [0],
	}),
	scenario(
		'nas-accel-exposed',
		attention,
		'FailSafe on the drives, acceleration on one SSD',
		'A switch that stopped before the SSD got its mirror. Not "Protected".',
		{layout: 'raidz1', members: 'h8,h8,h8', accel: 's1'},
	),
	scenario('nas-offline', attention, 'Too many drives are gone', 'Storage is offline.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8',
		failed: [0],
		missing: [2],
	}),
	scenario(
		'nas-damaged',
		attention,
		'Some data is damaged',
		'One red state, whichever way it was found. Leads with backups.',
		{
			layout: 'stripe',
			members: 'h8,h8',
			dataErrors: 3,
		},
	),

	// Work in progress
	scenario('nas-rebuilding', progress, 'Rebuilding onto a new drive', 'Protection is on its way back.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8',
		rebuilding: 1,
		op: ({members}) => ({kind: 'rebuild', progress: 42, memberId: members[1]}),
	}),
	scenario('nas-expanding', progress, 'Adding a drive', 'Storage stays in use while it grows.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8,h8',
		joining: true,
		loose: 'h8',
		op: ({members}) => ({kind: 'expand', progress: 18, memberId: members[4]}),
	}),
	scenario('nas-transition', progress, 'Turning on FailSafe · copying', 'The first step: a copy to the new drive.', {
		layout: 'stripe',
		members: 'h8',
		loose: 'h8',
		op: ({loose}) => ({kind: 'failsafe', phase: 'copying', progress: 34, to: 'raidz1', newIds: loose}),
	}),
	scenario(
		'nas-transition-elsewhere',
		progress,
		'Turning on FailSafe · started somewhere else',
		'Opened on another device: umbreld says how far along, not which drives or which level.',
		{
			layout: 'stripe',
			members: 'h8',
			loose: 'h8',
			op: () => ({kind: 'failsafe', phase: 'copying', progress: 21}),
		},
	),
	scenario('nas-restarting', progress, 'Turning on FailSafe · restarting', 'The moment umbrelOS goes away.', {
		layout: 'stripe',
		members: 'h8',
		loose: 'h8',
		op: ({loose}) => ({kind: 'failsafe', phase: 'restarting', progress: 50, to: 'raidz1', newIds: loose}),
	}),
	scenario('nas-finishing', progress, 'Turning on FailSafe · protecting', 'The original drive is added.', {
		layout: 'raidz1',
		// After the restart the new drive holds the data, and the original is being added
		members: 'h8,h8',
		op: ({members}) => ({kind: 'failsafe', phase: 'rebuilding', progress: 67, to: 'raidz1', newIds: [members[0]]}),
	}),
	scenario(
		'nas-mirroring',
		progress,
		'Turning on FailSafe · mirrored pairs',
		'No restart: each drive is copied to its pair.',
		{
			layout: 'mirror',
			members: 'h8,h8,h8,h8',
			op: ({members}) => ({
				kind: 'failsafe',
				phase: 'rebuilding',
				progress: 27,
				to: 'mirror',
				newIds: [members[1], members[3]],
			}),
		},
	),
	scenario(
		'nas-check',
		progress,
		'A storage check is running',
		'Routine, and kept quiet. Try adding a drive from Simulate.',
		{
			layout: 'raidz1',
			members: 'h8,h8,h8,h8',
			op: () => ({kind: 'check', progress: 12}),
		},
	),
	scenario('nas-grew', progress, 'Just after a drive was added', 'Why used space went up a little.', {
		layout: 'raidz1',
		members: 'h8,h8,h8',
		finished: 'expand',
		used: 0.55,
	}),
	scenario('nas-switched', progress, 'Just after FailSafe was turned on', 'The moment a long task ends.', {
		layout: 'raidz1',
		members: 'h8,h8',
		finished: 'failsafe',
	}),
	scenario('nas-rebuilt', progress, 'Just after a rebuild', 'Protection is back, and when.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8',
		finished: 'rebuild',
	}),

	// A new drive
	scenario('pro-new', adding, 'Umbrel Pro · a new SSD', 'Add it and watch the space grow.', {
		device: 'pro',
		layout: 'raidz1',
		members: 's4,s4,s4',
		loose: 's4',
	}),
	scenario(
		'pro-second',
		adding,
		'Umbrel Pro · a second SSD',
		'The fork that can’t be undone: FailSafe or more space.',
		{device: 'pro', layout: 'stripe', members: 's2', loose: 's2', used: 0.3},
	),
	scenario('nas-single-new', adding, 'One hard drive, two new ones', 'Turn on FailSafe at any of the three levels.', {
		layout: 'stripe',
		members: 'h8',
		loose: 'h8,h8',
	}),
	scenario(
		'nas-full-new',
		adding,
		'Full Storage · two drives, two new ones',
		'Every drive gets a new drive to pair with.',
		{
			layout: 'stripe',
			members: 'h8,h8',
			loose: 'h8,h8',
		},
	),
	scenario(
		'nas-full-mixed-new',
		adding,
		'Full Storage · 8, 8 and 4TB, with new 8, 8 and 4TB',
		'Each new drive only has to match the drive it pairs with.',
		{layout: 'stripe', members: 'h8,h8,h4', loose: 'h8,h4,h8'},
	),
	scenario('nas-full-short', adding, 'Full Storage · three drives, one new one', 'Says what each pair still needs.', {
		layout: 'stripe',
		members: 'h8,h8,h4',
		loose: 'h8',
	}),
	scenario(
		'nas-z1-three-new',
		adding,
		'One-drive protection · three new drives',
		'Added one at a time, and where it ends.',
		{
			layout: 'raidz1',
			members: 'h8,h8,h8',
			loose: 'h8,h8,h8',
		},
	),
	scenario('nas-limit', adding, 'One-drive protection · already six drives', 'The limit, and what to do instead.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8,h8,h8',
		loose: 'h8',
	}),
	scenario('nas-too-small', adding, 'A new drive that is too small', 'A 4TB drive for storage made of 8TB drives.', {
		layout: 'raidz1',
		members: 'h8,h8,h8',
		loose: 'h4',
	}),
	scenario('nas-bigger', adding, 'A new drive that is bigger', 'A 16TB drive for storage made of 8TB drives.', {
		layout: 'raidz1',
		members: 'h8,h8,h8',
		loose: 'h16',
	}),
	scenario('nas-mirror-one', adding, 'Mirrored pairs · one new drive', 'Waiting for a second.', {
		layout: 'mirror',
		members: 'h8,h8',
		loose: 'h8',
	}),
	scenario('nas-mirror-two', adding, 'Mirrored pairs · two new drives', 'A new pair, ready at once. Both are listed.', {
		layout: 'mirror',
		members: 'h8,h8',
		loose: 'h12,h12',
	}),
	scenario('nas-ssds-new', adding, 'Two new SSDs beside hard drives', 'Offered as SSD Acceleration.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8',
		loose: 's1,s1',
	}),
	scenario('nas-ssd-one', adding, 'One new SSD beside FailSafe hard drives', 'One short of a pair.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8',
		loose: 's1',
	}),
	scenario(
		'nas-accel-single-new',
		adding,
		'One accelerated hard drive, a new drive and a new SSD',
		'FailSafe needs a second SSD too, and uses it.',
		{layout: 'stripe', members: 'h8', accel: 's1', loose: 'h8,s1'},
	),
	scenario(
		'nas-full-accel-new',
		adding,
		'Full Storage with one SSD · two new hard drives',
		'The card and the sheet agree that an SSD is still missing.',
		{layout: 'stripe', members: 'h12,h12', accel: 's1', loose: 'h12,h12'},
	),
	scenario('flash-hdd', adding, 'A hard drive beside SSD storage', 'It can’t join, and the card says why.', {
		layout: 'raidz1',
		members: 's2,s2,s2',
		loose: 'h8',
	}),
	scenario('nas-new-failing', adding, 'A new drive that is failing its health check', 'Not offered for anything.', {
		layout: 'raidz1',
		members: 'h8,h8,h8',
		loose: 'h8!',
	}),

	// Swapping a working drive
	scenario(
		'swap-failsafe',
		swapping,
		'FailSafe · swap a drive for a bigger one',
		'Tap a drive, then Swap. With a free bay the new drive goes in first.',
		{layout: 'raidz1', members: 'h8,h8,h8,h8'},
	),
	scenario(
		'swap-failsafe-ready',
		swapping,
		'FailSafe · the new drive is already in',
		'Both drives are named, with their serial numbers.',
		{
			layout: 'raidz1',
			members: 'h8,h8,h8,h8',
			loose: 'h16',
		},
	),
	scenario('swap-blocked', swapping, 'FailSafe · another drive has a problem', 'Why this drive has to stay.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8',
		trouble: {errors: [0]},
	}),
	scenario(
		'swap-pro-free',
		swapping,
		'Umbrel Pro · FailSafe, a slot free',
		'The new SSD goes in the empty slot first.',
		{
			device: 'pro',
			layout: 'raidz1',
			members: 's4,s4,s4',
		},
	),
	scenario(
		'swap-pro-full',
		swapping,
		'Umbrel Pro · FailSafe, every slot used',
		'In place, with what that costs said first.',
		{
			device: 'pro',
			layout: 'raidz1',
			members: 's4,s4,s4,s4',
		},
	),
	scenario('swap-full-free', swapping, 'Umbrel Pro · Full Storage, a slot free', 'The new SSD goes in alongside.', {
		device: 'pro',
		layout: 'stripe',
		members: 's2,s2',
	}),
	scenario(
		'swap-full-none',
		swapping,
		'Umbrel Pro · Full Storage, every slot used',
		'No room for both: back up, reset and restore.',
		{device: 'pro', layout: 'stripe', members: 's2,s2,s2,s2'},
	),

	// Explaining what can't be done
	scenario('pro-mixed', limits, 'Mixed sizes in FailSafe', 'Where the unusable space is, and how to get it back.', {
		device: 'pro',
		layout: 'raidz1',
		members: 's2,s2,s4,s4',
	}),
	scenario(
		'pro-full-multi',
		limits,
		'Umbrel Pro · three SSDs in Full Storage',
		'FailSafe can’t be turned on, and the honest reason.',
		{device: 'pro', layout: 'stripe', members: 's2,s2,s2'},
	),
	scenario('nas-transition-failed', limits, 'FailSafe didn’t turn on', 'Nothing was lost, try again.', {
		layout: 'stripe',
		members: 'h8',
		loose: 'h8',
		failsafeError: 'Failed to send snapshot to the migration pool: cannot receive new filesystem stream: out of space',
	}),
	scenario(
		'nas-partial',
		limits,
		'FailSafe was only partly turned on',
		'One pair is mirrored, one drive isn’t. umbreld can’t finish it by itself.',
		{layout: 'stripe', members: 'h8,h8,h8', partial: [[0, 1]]},
	),
	scenario(
		'nas-partial-accel',
		limits,
		'FailSafe on, but acceleration left on one SSD',
		'Every drive is paired. The SSD that holds the index isn’t.',
		{layout: 'stripe', members: 'h8,h8', accel: 's1', partial: [[0, 1]]},
	),
	scenario('nas-accel-extra', limits, 'A third SSD when acceleration is on', 'It can only wait as a spare.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8',
		accel: 's1,s1',
		loose: 's1',
	}),
	scenario('nas-accel-full', limits, 'SSD Acceleration is nearly full', 'What happens, and why it’s fine.', {
		layout: 'raidz1',
		members: 'h8,h8,h8,h8',
		accel: 's1,s1',
		accelUsed: 0.78,
	}),
]

export const sizesTb = {hdd: [4, 8, 12, 16], ssd: [1, 2, 4]} as const

// ---------------------------------------------------------------------------
// The screens around Storage Manager
// ---------------------------------------------------------------------------

export type OtherScenario = {
	id: string
	group: string
	title: string
	note: string
	// The path within the lab
	path: string
}

const starting = 'Storage that won’t start'
const single = 'Devices with one drive'
const finding = 'How you find out'

export const otherScenarios: OtherScenario[] = [
	{
		id: 'boot-pro',
		group: starting,
		title: 'Umbrel Pro · SSDs aren’t responding',
		note: 'The screen shown instead of login. Worded without knowing the storage mode, which umbreld doesn’t say here.',
		path: '/storage-lab/start/pro',
	},
	{
		id: 'boot-nas',
		group: starting,
		title: 'Hard drives · drives aren’t responding',
		note: 'The same screen on other hardware.',
		path: '/storage-lab/start/nas',
	},
	{
		id: 'unreadable',
		group: starting,
		title: 'Storage Manager can’t read the storage',
		note: 'Signed in, but umbreld didn’t answer.',
		path: '/storage-lab/single/unreadable',
	},
	{
		id: 'unidentified',
		group: starting,
		title: 'Storage Manager can’t identify the storage',
		note: 'The drives are listed, and nothing is guessed.',
		path: '/storage-lab/single/unidentified',
	},
	{
		id: 'home',
		group: single,
		title: 'Umbrel Home',
		note: 'One built-in SSD. Use Simulate for failing, hot, worn and nearly full.',
		path: '/storage-lab/single/home',
	},
	{
		id: 'pi',
		group: single,
		title: 'Raspberry Pi',
		note: 'A microSD card or one external drive, which umbreld can’t see.',
		path: '/storage-lab/single/pi',
	},
	{
		id: 'pc',
		group: single,
		title: 'Other hardware, set up on its boot drive',
		note: 'With spare drives connected, and the true way to use them.',
		path: '/storage-lab/single/pc',
	},
	{
		id: 'container',
		group: single,
		title: 'umbrelOS in a container',
		note: 'Storage belongs to the host.',
		path: '/storage-lab/single/container',
	},
	{
		id: 'notices',
		group: finding,
		title: 'Toast, Settings, island and notification',
		note: 'Every way umbrelOS brings storage up before Storage Manager is open, in the same words.',
		path: '/storage-lab/notices',
	},
]
