// The rules of umbrelOS storage, as the UI needs them: what each layout does with a set of
// drives, which layouts a set of drives allows, and what Umbrel would choose.
//
// Everything here is pure. It encodes what umbreld accepts (see
// packages/umbreld/source/modules/hardware/raid.ts), so the screens only ever offer what
// the real call would take:
//   - storage is all SSDs or all hard drives, never both
//   - SSDs: stripe or RAID-Z1
//   - hard drives: stripe, RAID-Z1 (2 to 6 drives), RAID-Z2 (3 or more), or mirrored pairs
//   - RAID-Z only uses as much of each drive as the smallest one has
//   - hard drive storage can take SSD acceleration: one SSD in Full Storage, two in FailSafe

export const TB = 1_000_000_000_000
export const GB = 1_000_000_000
export const MAX_HDD_RAIDZ1_DRIVES = 6

export type DriveKind = 'hdd' | 'ssd'

// Umbrel Pro has four numbered SSD slots. 'other' is any other machine with drives besides
// the one umbrelOS runs from: umbreld can't tell how many bays it has or which is which.
export type DeviceModel = 'pro' | 'other'

export type Drive = {
	id: string
	kind: DriveKind
	// What umbreld compares drives by: the size rounded the way it partitions them. 0 when it
	// isn't known, which only happens to a drive the machine can no longer see.
	size: number
	model: string
	serial: string
	// Umbrel Pro's SSD slot, 1 to 4
	slot?: number
	// The drive's own health check. Unknown when the drive doesn't report one.
	smart: 'healthy' | 'unhealthy' | 'unknown'
	// Degrees Celsius, with the drive's own limits. Only NVMe SSDs report limits.
	temperature?: number
	temperatureWarning?: number
	temperatureCritical?: number
	// How much of its rated life an SSD has used, in percent. Only NVMe SSDs report it.
	lifetimeUsed?: number
	// The drive umbrelOS itself runs from on other hardware: never usable for storage
	system?: boolean
	// A member of the storage that the machine can no longer see
	absent?: boolean
	// Read, write and checksum errors the storage has seen on the drive while it kept working
	errors?: number
	// The storage still uses the drive, but has seen so many errors on it that it no longer
	// trusts it (ZFS calls the member DEGRADED)
	degraded?: boolean
}

export type Hardware = {device: DeviceModel; drives: Drive[]}

// 100 means the rated endurance is fully used
export const LIFETIME_WARNING_THRESHOLD = 80

// What is wrong with a drive that still works, most serious first
export type Trouble = 'failing' | 'faulty' | 'critical' | 'errors' | 'hot' | 'worn'

export function troubleOf(drive: Drive | undefined): Trouble | null {
	if (!drive) return null
	if (drive.smart === 'unhealthy') return 'failing'
	if (drive.degraded) return 'faulty'
	const {temperature, temperatureCritical, temperatureWarning} = drive
	if (temperature !== undefined && temperatureCritical !== undefined && temperature >= temperatureCritical)
		return 'critical'
	if (drive.errors) return 'errors'
	if (temperature !== undefined && temperatureWarning !== undefined && temperature >= temperatureWarning) return 'hot'
	if (drive.lifetimeUsed !== undefined && drive.lifetimeUsed >= LIFETIME_WARNING_THRESHOLD) return 'worn'
	return null
}

export const isFailing = (drive: Drive) => drive.smart === 'unhealthy'

// Umbrel Pro only knows the slot of an SSD it can see. A missing one can still be placed when
// there are exactly as many empty slots as missing SSDs: then each empty slot is where one was.
// Which missing SSD was in which of them doesn't matter, since each slot gets a new one.
export function placeMissing(drives: Drive[]): Drive[] {
	const taken = new Set(drives.filter((drive) => !drive.absent && drive.slot).map((drive) => drive.slot))
	const empty = [1, 2, 3, 4].filter((slot) => !taken.has(slot))
	const missing = drives.filter((drive) => drive.absent && !drive.system)
	if (missing.length === 0 || missing.length !== empty.length) {
		return drives.map((drive) => (drive.absent && drive.slot ? {...drive, slot: undefined} : drive))
	}
	return drives.map((drive) => (drive.absent ? {...drive, slot: empty[missing.indexOf(drive)]} : drive))
}

export type Layout = 'stripe' | 'raidz1' | 'raidz2' | 'mirror'
export type FailsafeLayout = Exclude<Layout, 'stripe'>

// The names people who know storage look for. Everywhere else a layout is named by what it promises.
export const layoutTech: Record<Layout, string> = {
	stripe: 'Stripe',
	raidz1: 'RAID-Z1',
	raidz2: 'RAID-Z2',
	mirror: 'Mirror',
}

export const failsafeLayoutsFor = (kind: DriveKind): FailsafeLayout[] =>
	kind === 'hdd' ? ['raidz1', 'raidz2', 'mirror'] : ['raidz1']

export const parityOf = (layout: Layout) => (layout === 'raidz2' ? 2 : layout === 'raidz1' ? 1 : 0)

export function formatSize(bytes: number): string {
	if (bytes >= TB) {
		const value = bytes / TB
		const text = value >= 100 ? Math.round(value).toString() : (Math.round(value * 10) / 10).toString()
		return `${text}TB`
	}
	return `${Math.max(1, Math.round(bytes / GB))}GB`
}

const bySizeDesc = (a: Drive, b: Drive) => b.size - a.size || a.id.localeCompare(b.id)

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

// What the storage does with one drive: `used` is the part of it the storage reaches, of which
// `protection` is set aside for FailSafe, and `unused` is the part it can't reach because
// another drive is smaller.
export type DriveShare = {used: number; protection: number; unused: number}

export type Capacity = {
	usable: number
	protection: number
	unused: number
	raw: number
	shares: Record<string, DriveShare>
	// Mirrored layouts only: which drives are paired
	pairs: [string, string][]
}

// Mirrors pair neighbours by size, largest first, so the two drives of a pair are as alike as possible
export function pairDrives(drives: Drive[]): [Drive, Drive][] {
	const sorted = [...drives].sort(bySizeDesc)
	const pairs: [Drive, Drive][] = []
	for (let i = 0; i + 1 < sorted.length; i += 2) pairs.push([sorted[i], sorted[i + 1]])
	return pairs
}

// `pairs` keeps an existing mirror's real pairs instead of re-pairing them by size
export function getCapacity(layout: Layout, drives: Drive[], pairs?: [Drive, Drive][]): Capacity {
	const shares: Record<string, DriveShare> = {}
	const raw = drives.reduce((sum, drive) => sum + drive.size, 0)
	const result: Capacity = {usable: 0, protection: 0, unused: 0, raw, shares, pairs: []}
	if (drives.length === 0) return result

	if (layout === 'stripe') {
		for (const drive of drives) shares[drive.id] = {used: drive.size, protection: 0, unused: 0}
		result.usable = raw
		return result
	}

	if (layout === 'mirror') {
		for (const [first, second] of pairs ?? pairDrives(drives)) {
			const [big, small] = first.size >= second.size ? [first, second] : [second, first]
			shares[big.id] = {used: small.size, protection: 0, unused: big.size - small.size}
			shares[small.id] = {used: small.size, protection: small.size, unused: 0}
			result.usable += small.size
			result.protection += small.size
			result.unused += big.size - small.size
			result.pairs.push([first.id, second.id])
		}
		// A drive with no partner isn't reachable at all
		for (const drive of drives) {
			if (!shares[drive.id]) {
				shares[drive.id] = {used: 0, protection: 0, unused: drive.size}
				result.unused += drive.size
			}
		}
		return result
	}

	const parity = parityOf(layout)
	const smallest = Math.min(...drives.map((drive) => drive.size))
	for (const drive of drives) {
		shares[drive.id] = {
			used: smallest,
			protection: (smallest * parity) / drives.length,
			unused: drive.size - smallest,
		}
	}
	result.usable = Math.max(0, drives.length - parity) * smallest
	result.protection = Math.min(parity, drives.length) * smallest
	result.unused = raw - drives.length * smallest
	return result
}

// Why a layout can't be built from this many drives
export type LayoutProblem = 'no-drives' | 'hdd-only' | 'needs-two' | 'needs-three' | 'too-many' | 'needs-even'

export function layoutProblem(layout: Layout, kind: DriveKind, count: number): LayoutProblem | null {
	if (count === 0) return 'no-drives'
	if (layout === 'stripe') return null
	if (layout !== 'raidz1' && kind !== 'hdd') return 'hdd-only'
	if (layout === 'raidz2') return count < 3 ? 'needs-three' : null
	if (count < 2) return 'needs-two'
	if (layout === 'raidz1' && kind === 'hdd' && count > MAX_HDD_RAIDZ1_DRIVES) return 'too-many'
	if (layout === 'mirror' && count % 2 !== 0) return 'needs-even'
	return null
}

// The drives that give a layout the most usable space. RAID-Z is held back by its smallest
// drive, so leaving a small one out can be worth more than including it.
export function bestSubset(layout: Layout, kind: DriveKind, drives: Drive[]): Drive[] {
	const sorted = [...drives].sort(bySizeDesc)
	if (layout === 'stripe') return sorted
	if (layout === 'mirror') return sorted.slice(0, sorted.length - (sorted.length % 2))

	const parity = parityOf(layout)
	const most = layout === 'raidz1' && kind === 'hdd' ? MAX_HDD_RAIDZ1_DRIVES : Infinity
	let best: Drive[] = []
	let bestUsable = 0
	for (let count = parity + 1; count <= Math.min(sorted.length, most); count++) {
		const usable = (count - parity) * sorted[count - 1].size
		// Ties go to fewer drives: nothing is gained by tying up one more
		if (usable > bestUsable) {
			best = sorted.slice(0, count)
			bestUsable = usable
		}
	}
	return best
}

export type LevelOption = {
	layout: FailsafeLayout
	drives: Drive[]
	problem: LayoutProblem | null
	capacity: Capacity
	recommended: boolean
}

// Every FailSafe level for these drives. With `exact` the drives are used as given;
// otherwise each level gets the subset that suits it best.
export function getLevelOptions(kind: DriveKind, drives: Drive[], exact: boolean): LevelOption[] {
	const options = failsafeLayoutsFor(kind).map((layout) => {
		const subset = exact ? drives : bestSubset(layout, kind, drives)
		const problem = layoutProblem(layout, kind, exact ? drives.length : subset.length || drives.length)
		return {layout, drives: subset, problem, capacity: getCapacity(layout, subset), recommended: false}
	})
	const valid = options.filter((option) => !option.problem)
	const find = (layout: FailsafeLayout) => valid.find((option) => option.layout === layout)

	// Which level Umbrel suggests, in one place so it's easy to argue with:
	//   - two hard drives: a mirrored pair, umbreld's own default
	//   - six or more drives: two-drive protection, because a hard drive rebuild takes days
	//   - otherwise one-drive protection, which gives the most space and grows a drive at a time
	//   - unless mirrored pairs give a quarter more space, which mixed sizes in pairs can do
	const mirror = find('mirror')
	let pick = (drives.length >= 6 ? find('raidz2') : undefined) ?? find('raidz1') ?? find('raidz2') ?? mirror
	if (pick && mirror && pick !== mirror && mirror.capacity.usable >= pick.capacity.usable * 1.25) pick = mirror
	if (kind === 'hdd' && drives.length === 2 && mirror) pick = mirror
	if (pick) pick.recommended = true
	return options
}

// Whether the data is still readable with these drives down. `accel` are the acceleration
// SSDs, which hold part of the storage: with two, one can go; with one, none can.
export function survives(
	layout: Layout,
	drives: Drive[],
	pairs: [string, string][],
	downIds: string[],
	accel: Drive[] = [],
): boolean {
	const accelDown = accel.filter((drive) => downIds.includes(drive.id)).length
	if (accel.length > 0 && accelDown === accel.length) return false
	const down = drives.filter((drive) => downIds.includes(drive.id)).length
	if (layout === 'stripe') return down === 0
	if (layout === 'mirror') return !pairs.some(([a, b]) => downIds.includes(a) && downIds.includes(b))
	return down <= parityOf(layout)
}

// ---------------------------------------------------------------------------
// Setting up: what Umbrel suggests, and what the person changed
// ---------------------------------------------------------------------------

export type SetupChoices = {
	kind?: DriveKind
	selected?: string[]
	protect?: boolean
	level?: FailsafeLayout
	// false turns acceleration off
	accel?: string[] | false
}

// Why a drive of the storage's kind isn't used
export type LeftOutReason =
	// It is failing its own health check
	| 'failing'
	// Mirrored pairs: it has no partner
	| 'no-pair'
	// One-drive protection takes up to six hard drives
	| 'limit'
	// With it, every drive would be limited to its size
	| 'shrinks'
	// The person switched it off
	| 'choice'

export type Setup = {
	// The drive umbrelOS runs from, when the machine has one apart from its storage
	system?: Drive
	kind: DriveKind
	// Every drive of the storage's kind, and the rest
	candidates: Drive[]
	others: Drive[]
	selected: Drive[]
	leftOut: {drive: Drive; reason: LeftOutReason}[]
	canProtect: boolean
	// FailSafe is what Umbrel suggests for these drives
	recommendProtect: boolean
	protect: boolean
	level: FailsafeLayout | null
	// The level the person chose stopped fitting the drives they chose, so another took its place
	levelChanged?: {from: FailsafeLayout; to: FailsafeLayout; problem: LayoutProblem}
	layout: Layout
	levels: LevelOption[]
	capacity: Capacity
	// What Full Storage and FailSafe would each give, for the two mode cards
	storageUsable: number
	failsafeUsable: number
	// Every drive of the kind is failing its health check, so they are used anyway
	allFailing: boolean
	accel: {
		available: Drive[]
		needed: 1 | 2
		chosen: Drive[]
	}
	erased: Drive[]
}

function pickAccelerators(ssds: Drive[], needed: 1 | 2): Drive[] {
	const sorted = [...ssds].sort(bySizeDesc)
	if (sorted.length < needed) return []
	if (needed === 1) return [sorted[0]]
	// Prefer the largest two that match, since the pair is mirrored
	for (let i = 0; i + 1 < sorted.length; i++) {
		if (sorted[i].size === sorted[i + 1].size) return [sorted[i], sorted[i + 1]]
	}
	return sorted.slice(0, 2)
}

export function resolveSetup(hardware: Hardware, choices: SetupChoices = {}): Setup {
	// umbreld refuses the system drive ("Cannot use the system drive for RAID"), so it is never offered
	const drives = hardware.drives.filter((drive) => !drive.system)
	const hdds = drives.filter((drive) => drive.kind === 'hdd')
	const sound = (list: Drive[]) => list.filter((drive) => !isFailing(drive))
	// Hard drives hold the data when there are any, and SSDs speed them up, as today. With both
	// kinds in the machine the person can choose SSDs instead. The kind comes from every drive,
	// failing ones included: a machine whose only SSD is failing its health check still sets up
	// on SSDs.
	const defaultKind: DriveKind = hdds.length > 0 ? 'hdd' : 'ssd'
	const kind = choices.kind && drives.some((drive) => drive.kind === choices.kind) ? choices.kind : defaultKind
	const candidates = drives.filter((drive) => drive.kind === kind)
	const others = drives.filter((drive) => drive.kind !== kind)
	// A drive that is failing its own health check stays out, unless there is nothing else
	const healthy = sound(candidates)
	const allFailing = candidates.length > 0 && healthy.length === 0
	const trusted = allFailing ? candidates : healthy

	const explicit = choices.selected ? candidates.filter((drive) => choices.selected!.includes(drive.id)) : undefined

	const levels = getLevelOptions(kind, explicit ?? trusted, !!explicit)
	const validLevels = levels.filter((option) => !option.problem)
	const canProtect = validLevels.length > 0
	const chosenLevel = validLevels.find((option) => option.layout === choices.level)
	const level = chosenLevel ?? validLevels.find((option) => option.recommended) ?? validLevels[0] ?? null
	// FailSafe is what Umbrel suggests whenever it costs only what protection has to cost. With
	// drives of different sizes, where FailSafe would leave space unusable or leave a drive out,
	// Full Storage is the default, as today, and neither is marked as recommended.
	const suggested = validLevels.find((option) => option.recommended)
	const recommendProtect =
		!!suggested && suggested.capacity.unused === 0 && suggested.drives.length === (explicit ?? trusted).length
	const protect = canProtect && (choices.protect ?? recommendProtect)
	const layout: Layout = protect && level ? level.layout : 'stripe'
	const selected = explicit ?? (protect && level ? level.drives : trusted)
	const capacity = getCapacity(layout, selected)

	// The chosen level no longer fits the chosen drives: say so instead of switching quietly
	const lostLevel = choices.level && !chosenLevel ? levels.find((option) => option.layout === choices.level) : undefined
	const levelChanged =
		protect && level && lostLevel?.problem
			? {from: lostLevel.layout, to: level.layout, problem: lostLevel.problem}
			: undefined

	const smallestSelected = selected.length ? Math.min(...selected.map((drive) => drive.size)) : 0
	const leftOut = candidates
		.filter((drive) => !selected.includes(drive))
		.map((drive): {drive: Drive; reason: LeftOutReason} => {
			if (explicit) return {drive, reason: 'choice'}
			if (isFailing(drive)) return {drive, reason: 'failing'}
			if (layout === 'mirror') return {drive, reason: 'no-pair'}
			if (layout === 'raidz1' && kind === 'hdd' && selected.length >= MAX_HDD_RAIDZ1_DRIVES)
				return {drive, reason: 'limit'}
			if (drive.size < smallestSelected) return {drive, reason: 'shrinks'}
			return {drive, reason: 'choice'}
		})

	const needed: 1 | 2 = protect ? 2 : 1
	const available = kind === 'hdd' ? sound(others.filter((drive) => drive.kind === 'ssd')) : []
	const defaultAccel = pickAccelerators(available, needed)
	let chosen: Drive[] = []
	if (choices.accel !== false) {
		const picked = choices.accel ? available.filter((drive) => (choices.accel as string[]).includes(drive.id)) : []
		chosen = picked.length === needed ? picked : defaultAccel
	}

	return {
		system: hardware.drives.find((drive) => drive.system),
		kind,
		candidates,
		others,
		selected,
		leftOut,
		canProtect,
		recommendProtect,
		protect,
		level: level?.layout ?? null,
		levelChanged,
		layout,
		levels,
		capacity,
		storageUsable: getCapacity('stripe', explicit ?? trusted).usable,
		failsafeUsable: level ? level.capacity.usable : 0,
		allFailing,
		accel: {available, needed, chosen},
		erased: [...selected, ...chosen],
	}
}

// What user.register takes
export type StorageConfig = {
	raidDevices: string[]
	raidType: 'storage' | 'failsafe'
	failsafeLayout?: FailsafeLayout
	acceleratorDevices?: string[]
}

export function toStorageConfig(setup: Setup): StorageConfig {
	// Mirrored pairs are passed pair by pair, the order umbreld builds them in
	const ordered =
		setup.layout === 'mirror' ? setup.capacity.pairs.flatMap((pair) => pair) : setup.selected.map((drive) => drive.id)
	return {
		raidDevices: ordered,
		raidType: setup.layout === 'stripe' ? 'storage' : 'failsafe',
		failsafeLayout: setup.layout === 'stripe' ? undefined : setup.layout,
		acceleratorDevices: setup.accel.chosen.length > 0 ? setup.accel.chosen.map((drive) => drive.id) : undefined,
	}
}
