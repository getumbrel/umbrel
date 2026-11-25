// What Storage Manager says first: one sentence about the storage, and the one thing to do
// about it. The order below is the order of what matters to someone's data.

import type {TFunction} from 'i18next'

import type {StatusTone} from '../art'
import {Drive, DriveKind, troubleOf} from '../model'
import {promiseSentence} from '../phrases'
import {
	accelExposed,
	failsafeStep,
	firstTroubled,
	fullness,
	getFailsafePlan,
	getOffers,
	getSwapPlan,
	isBroken,
	Member,
	NEARLY_FULL,
	newDriveKinds,
	PoolView,
	StepsVariant,
	StorageAction,
	StorageState,
} from '../state'
import {forKind} from '../words'

// Every sheet Storage Manager can open
export type Sheet =
	| {type: 'drive'; id: string}
	// `broken` when the drive being replaced was down as the sheet opened
	| {type: 'replace'; memberId: string; newId: string; broken: boolean}
	| {type: 'repair'; memberId: string}
	| {type: 'steps'; memberId: string; variant: StepsVariant; risky?: boolean}
	| {type: 'blocked'; memberId: string}
	| {type: 'new'; kind: DriveKind; offer?: 'replace' | 'add' | 'pair' | 'accelerate'}
	| {type: 'failsafe'}
	| {type: 'acceleration'}
	| {type: 'check'}
	| {type: 'details'}
	| {type: 'install'}
	| {type: 'offline'}
	| null

export type StatusAction = {
	label: string
	sheet?: NonNullable<Sheet>
	run?: StorageAction
	// Leaves Storage Manager for Backups
	backups?: boolean
	variant?: 'primary' | 'default'
}

export type StatusContent = {
	tone: StatusTone
	title: string
	body: string
	// The task's one number, 0 to 100
	progress?: number
	// Which of Copy, Restart and Protect a switch to FailSafe has reached
	step?: number
	// It carries on after a shutdown, so shutting down is safe
	resumes?: boolean
	// umbreld's own words, for anyone who wants them
	detail?: string
	// It is about running out of space, not about the drives
	space?: boolean
	actions?: StatusAction[]
}

// Where a tap on Replace or Swap leads: straight to a confirmation when a suitable drive is
// already in, otherwise to the steps for changing the drive by hand
export function sheetForSwap(state: StorageState, memberId: string): NonNullable<Sheet> {
	const plan = getSwapPlan(state, memberId)
	if (plan.kind === 'replace') return {type: 'replace', memberId, newId: plan.newId, broken: !plan.keepsOld}
	if (plan.kind === 'repair') return {type: 'repair', memberId}
	if (plan.kind === 'steps') return {type: 'steps', memberId, variant: plan.variant, risky: plan.risky}
	return {type: 'blocked', memberId}
}

// Whether what a sheet was opened for is still true. Storage changes on its own: a drive comes
// back, another fails, a new one is plugged in. A sheet left open through that would go on to
// confirm something the person never read, so it closes instead and the window shows what is
// true now.
export function sheetStands(state: StorageState, view: PoolView, sheet: Sheet): boolean {
	if (!sheet) return true
	if (sheet.type === 'drive') return !!view.driveOf(sheet.id)
	// A storage that has stopped can't be changed: only what explains it stays open
	if (view.status === 'offline') return sheet.type === 'offline' || sheet.type === 'details'
	if (sheet.type === 'offline') return false
	if (sheet.type === 'new') {
		const offers = getOffers(state, sheet.kind)
		return sheet.offer ? offers.some((offer) => offer.id === sheet.offer) : offers.length > 0
	}
	if (sheet.type === 'replace' || sheet.type === 'repair' || sheet.type === 'steps' || sheet.type === 'blocked') {
		// The same drive, in the same state, with the same way forward
		if (!view.stateOf(sheet.memberId)) return false
		const now = sheetForSwap(state, sheet.memberId)
		if (now.type !== sheet.type) return false
		if (now.type === 'replace' && sheet.type === 'replace') {
			return now.newId === sheet.newId && now.broken === sheet.broken
		}
		if (now.type === 'steps' && sheet.type === 'steps') {
			return now.variant === sheet.variant && !!now.risky === !!sheet.risky
		}
		return true
	}
	return true
}

// "Replace SSD 2", "Replace SSD", "Replace drive": a button says what it does to what
export function driveActionLabel(t: TFunction, verb: 'replace' | 'repair' | 'swap' | 'view', drive: Drive | undefined) {
	if (drive?.slot) return t(`storage-mgr.action.${verb}.slot`, {slot: drive.slot})
	return t(`storage-mgr.action.${verb}.${drive?.kind === 'ssd' ? 'ssd' : 'drive'}`)
}

// Data a storage check couldn't repair, as it is said wherever it is raised: in Storage
// Manager, in the toast when a check ends, and in the notification umbreld leaves behind
export const damageNotice = (t: TFunction, count: number) => ({
	title: t('storage-mgr.status.damage.title'),
	body: t('storage-mgr.status.damage.body', {count}),
})

const timeOf = (at: number, locale: string) =>
	new Intl.DateTimeFormat(locale, {hour: 'numeric', minute: '2-digit'}).format(new Date(at))

export function getStatus(state: StorageState, view: PoolView, plainT: TFunction, locale: string): StatusContent {
	// Storage made of SSDs is told about SSDs
	const t = forKind(plainT, state.pool.kind)
	const {layout, kind, members, accel} = state.pool
	const op = state.op
	const brokenData = view.down.filter(isBroken)
	const brokenAccel = view.accelDown.filter(isBroken)
	const repair = (member: Member): StatusAction => {
		const plan = getSwapPlan(state, member.id)
		return {
			label: driveActionLabel(t, plan.kind === 'repair' ? 'repair' : 'replace', view.driveOf(member.id)),
			sheet: sheetForSwap(state, member.id),
			variant: 'primary',
		}
	}

	if (view.status === 'offline') {
		const accelGone = accel.length > 0 && view.accelDown.length === accel.length
		return {
			tone: 'critical',
			title: t('storage-mgr.status.offline.title'),
			body: accelGone
				? t('storage-mgr.status.offline.accel', {count: accel.length})
				: view.down.length === 0
					? // umbreld says the storage has stopped, and no drive shows why
						t('storage-mgr.status.offline.unknown')
					: layout === 'stripe'
						? t(`storage-mgr.status.offline.full.${kind}`)
						: t('storage-mgr.status.offline.failsafe'),
			actions: [{label: t('storage-mgr.action.fix'), sheet: {type: 'offline'}, variant: 'primary'}],
		}
	}

	if (op?.kind === 'failsafe') {
		const {step, progress} = failsafeStep(op)
		if (step === null) {
			return {
				tone: 'busy',
				title: t('storage-mgr.status.switch.title'),
				body: t('storage-mgr.status.switch.pairs'),
				progress,
				resumes: true,
			}
		}
		if (step === 0) {
			return {
				tone: 'busy',
				title: t('storage-mgr.status.switch.title'),
				// How many new drives there are is only known to the session that started the switch
				body: op.newIds
					? t('storage-mgr.status.switch.copying', {count: op.newIds.length})
					: t('storage-mgr.status.switch.copying.unknown'),
				progress,
				step,
				resumes: true,
			}
		}
		if (step === 1) {
			return {
				tone: 'busy',
				title: t('storage-mgr.status.switch.restarting.title'),
				body: t('storage-mgr.status.switch.restarting'),
				step,
			}
		}
		return {
			tone: 'busy',
			title: t('storage-mgr.status.switch.title'),
			body: t('storage-mgr.status.switch.adding'),
			progress,
			step,
			resumes: true,
		}
	}

	if (op?.kind === 'rebuild') {
		const more = brokenData.length + brokenAccel.length
		return {
			tone: 'busy',
			title: t('storage-mgr.status.rebuild.title'),
			body: [
				t('storage-mgr.status.rebuild.body'),
				view.leaving ? t('storage-mgr.status.rebuild.keep-both') : '',
				// While the drive being replaced is still connected, it still protects the data. When it
				// isn't known which drive is being rebuilt, one- and pair-protected storage is taken to
				// be exposed, which it is unless the old drive is still in.
				(view.status === 'at-risk' || (!op.memberId && (layout === 'raidz1' || layout === 'mirror'))) && !view.leaving
					? t('storage-mgr.status.rebuild.at-risk')
					: '',
				more > 0 ? t('storage-mgr.status.rebuild.next') : '',
			]
				.filter(Boolean)
				.join(' '),
			progress: op.progress,
			resumes: true,
		}
	}

	if (brokenData.length > 0) {
		const first = brokenData[0]
		const count = brokenData.length
		const all = (memberState: Member['state']) => brokenData.every((member) => member.state === memberState)
		const what = all('missing') ? 'missing' : all('unusable') ? 'unusable' : all('failed') ? 'failed' : 'mixed'
		const consequence =
			view.status === 'reduced'
				? t('storage-mgr.status.broken.reduced')
				: layout === 'mirror'
					? t('storage-mgr.status.broken.pair')
					: t('storage-mgr.status.broken.at-risk')
		const remedy =
			what === 'missing'
				? t('storage-mgr.status.broken.remedy.missing', {count})
				: what === 'unusable'
					? // Rebuilt where it is when that is the way forward, replaced when a new drive is the better one
						t(
							getSwapPlan(state, first.id).kind === 'repair'
								? 'storage-mgr.status.broken.remedy.unusable'
								: 'storage-mgr.status.broken.remedy.unusable.replace',
							{count},
						)
					: count > 1
						? // umbreld rebuilds one drive at a time, and on hard drives each takes a day or more
							t('storage-mgr.status.broken.remedy.one-at-a-time')
						: view.status === 'reduced'
							? t('storage-mgr.status.broken.remedy.reduced')
							: t('storage-mgr.status.broken.remedy.soon')
		return {
			tone: view.status === 'reduced' ? 'attention' : 'critical',
			title: t(`storage-mgr.status.broken.${what}.${kind}`, {count}),
			body: `${consequence} ${remedy}`,
			actions: [repair(first)],
		}
	}

	if (brokenAccel.length > 0) {
		return {
			tone: 'critical',
			title: t('storage-mgr.status.accel-failed.title'),
			body: t('storage-mgr.status.accel-failed.body'),
			actions: [repair(brokenAccel[0])],
		}
	}

	// Errors a storage check couldn't repair are damaged data, whichever way they were found
	if (state.pool.dataErrors > 0) {
		const damage = damageNotice(t, state.pool.dataErrors)
		return {
			tone: 'critical',
			title: damage.title,
			body: `${damage.body} ${t('storage-mgr.status.damage.clears')}`,
			actions: [
				{label: t('storage-mgr.action.backups'), backups: true, variant: 'primary'},
				{label: t('storage-mgr.action.view-check'), sheet: {type: 'check'}},
			],
		}
	}

	if (op?.kind === 'expand') {
		return {
			tone: 'busy',
			title: t(`storage-mgr.status.expand.title.${kind}`),
			body: t('storage-mgr.status.expand.body'),
			progress: op.progress,
			resumes: true,
		}
	}

	if (state.pool.partialPairs || accelExposed(state)) {
		const paired = (state.pool.partialPairs?.length ?? 0) * 2
		return {
			tone: 'critical',
			title: t('storage-mgr.status.partly.title'),
			// With every drive protected, it is the acceleration SSD that was left on its own
			body: !state.pool.partialPairs
				? t('storage-mgr.status.partly.accel.protected')
				: paired >= members.length
					? t('storage-mgr.status.partly.accel')
					: t('storage-mgr.status.partly.body', {paired, total: members.length}),
			actions: [{label: t('storage-mgr.action.fix'), sheet: {type: 'failsafe'}, variant: 'primary'}],
		}
	}

	const troubled = firstTroubled(state, view)
	if (troubled) {
		const drive = view.driveOf(troubled.id)!
		const trouble = troubleOf(drive)!
		const protectedHere = layout !== 'stripe'
		const swap: StatusAction = {
			label: driveActionLabel(t, 'swap', drive),
			sheet: sheetForSwap(state, troubled.id),
			variant: 'primary',
		}
		const look: StatusAction = {label: driveActionLabel(t, 'view', drive), sheet: {type: 'drive', id: troubled.id}}
		const title = t(`storage-mgr.status.trouble.${trouble}.${drive.kind}`)
		if (trouble === 'failing' || trouble === 'faulty') {
			return {
				tone: 'attention',
				title,
				body: t(`storage-mgr.status.trouble.${trouble}.${protectedHere ? 'protected' : 'full'}`),
				actions: [swap],
			}
		}
		if (trouble === 'worn') {
			return {
				tone: 'attention',
				title,
				body: t(protectedHere ? 'storage-mgr.status.trouble.worn.protected' : 'storage-mgr.status.trouble.worn.full'),
				actions: [{...swap, variant: 'default'}],
			}
		}
		return {
			tone: trouble === 'critical' ? 'critical' : 'attention',
			title,
			body: t(`storage-mgr.status.trouble.${trouble}.body`),
			actions: [look],
		}
	}

	if (fullness(state, view) >= NEARLY_FULL) {
		return {
			tone: 'attention',
			title: t('storage-mgr.status.full.title'),
			body: t('storage-mgr.status.full.body'),
			space: true,
			actions: [{label: t(`storage-mgr.action.add.${kind}`), sheet: {type: 'install'}, variant: 'primary'}],
		}
	}

	// A new drive that can turn FailSafe on carries the button itself, on its own card
	const offeredOnCard = newDriveKinds(view).some((newKind) =>
		getOffers(state, newKind).some((offer) => offer.id === 'failsafe' && !offer.blocked),
	)

	if (state.failsafeError) {
		return {
			tone: 'attention',
			title: t('storage-mgr.status.switch-failed.title'),
			body: t('storage-mgr.status.switch-failed.body'),
			detail: state.failsafeError,
			actions: offeredOnCard ? undefined : [{label: t('try-again'), sheet: {type: 'failsafe'}, variant: 'primary'}],
		}
	}

	const accelCount = accel.length
	if (layout === 'stripe') {
		const plan = getFailsafePlan(state)
		const ready = plan.options.some(
			(option) => option.needs.every((need) => need.drive) && (!plan.accel || plan.accel.drive),
		)
		return {
			tone: 'unprotected',
			title: t('storage-mgr.status.full-storage.title'),
			body:
				accelCount > 0
					? t('storage-mgr.status.full-storage.accel')
					: members.length === 1
						? t(`storage-mgr.status.full-storage.one.${kind}`)
						: t(`storage-mgr.status.full-storage.many.${kind}`),
			actions: offeredOnCard
				? undefined
				: [
						plan.impossible
							? {label: t('storage-mgr.action.about-failsafe'), sheet: {type: 'failsafe'}}
							: ready
								? {label: t('storage-mgr.action.turn-on-failsafe'), sheet: {type: 'failsafe'}, variant: 'primary'}
								: {label: t('storage-mgr.action.set-up-failsafe'), sheet: {type: 'failsafe'}},
					],
		}
	}

	// A long task that ended while Storage Manager was open gets its moment
	const done = state.finished
	const sentence = promiseSentence(t, layout, kind, accelCount)
	if (done && done.kind !== 'expand') {
		return {
			tone: 'protected',
			title: t(done.kind === 'failsafe' ? 'storage-mgr.status.done.failsafe' : 'storage-mgr.status.done.rebuild'),
			body: `${sentence} ${t('storage-mgr.status.done.at', {time: timeOf(done.at, locale)})}`,
		}
	}
	return {
		tone: 'protected',
		title: t('storage-mgr.status.protected.title'),
		body: `${t('storage-mgr.status.protected.body')} ${sentence}`,
	}
}
