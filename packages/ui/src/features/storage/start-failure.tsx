// The screen shown in place of login when the storage can't start. Nobody is signed in, so
// umbreld only says which drives the storage is built from and whether each one answered: not
// whether the storage had FailSafe, and not what went wrong. The screen is worded from that.

import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {primaryButtonProps} from '@/layouts/bare/shared'
import {cn} from '@/lib/utils'

import {DriveView, StorageArt} from './art'
import {DriveFacts, TemperatureAdvice, TemperatureUnit} from './drive-facts'
import {DeviceModel, Drive, troubleOf} from './model'
import {
	Disclosure,
	DriveBanner,
	Note,
	PictureSide,
	Row,
	Rows,
	SectionLabel,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetRoot,
	SheetTitle,
	StepHeader,
} from './parts'
import {driveTitle, troubleNote} from './phrases'
import {ShutDownDialog} from './setup/storage-step'
import {forKind} from './words'

export type StartFailureDrive = {
	// The drive as far as it's known. A drive the machine can't see is `absent`, with whatever
	// its name in the storage gives away.
	drive: Drive
	// Part of the storage that couldn't start, and whether it answered. Left out for a drive that
	// isn't part of it. Without `responding`, umbreld couldn't say what part the drive has.
	member?: {responding?: boolean}
}

// On a phone each of the three buttons sits under its sentence, as wide as the row and a
// fingertip tall
const rowButton = 'max-sm:min-h-11 max-sm:w-full'

export function StartFailure({
	device,
	drives,
	loading,
	unconfirmed,
	checkError,
	checking,
	busy,
	onCheckAgain,
	onRestart,
	onShutdown,
	onFactoryReset,
	temperatureUnit = 'c',
	footerStart,
}: {
	device: DeviceModel
	drives: StartFailureDrive[]
	loading?: boolean
	// umbreld couldn't say whether the storage started at all. Nothing is known and nothing but
	// checking again is offered: restarting and resetting are only open to someone who isn't
	// signed in once the storage is known to have failed.
	unconfirmed?: boolean
	// The checks themselves failed: umbreld's own words
	checkError?: string
	checking?: boolean
	// A restart, shutdown or reset is already under way
	busy?: boolean
	onCheckAgain: () => void
	onRestart: () => void
	onShutdown: () => void
	onFactoryReset: () => void
	temperatureUnit?: TemperatureUnit
	// What sits at the start of the footer: the language menu
	footerStart?: React.ReactNode
}) {
	const {t: plainT} = useTranslation()
	const [dialog, setDialog] = useState<'restart' | 'shutdown' | 'reset' | null>(null)
	const [infoId, setInfoId] = useState<string | null>(null)
	const isPro = device === 'pro'
	const members = drives.filter((entry) => entry.member)
	const silent = members.filter((entry) => entry.drive.absent || entry.member?.responding === false)
	// Nothing is claimed about a drive umbreld couldn't speak for
	const unsure = (entry: StartFailureDrive) =>
		!!entry.member && !entry.drive.absent && entry.member.responding === undefined
	// With nothing but SSDs in the machine, it is told about SSDs
	const noun = drives.length > 0 && drives.every((entry) => entry.drive.kind === 'ssd') ? 'ssd' : 'drive'
	const t = forKind(plainT, noun)
	const info = drives.find((entry) => entry.drive.id === infoId)

	const views: DriveView[] = drives.map(({drive, member}) => {
		const trouble = drive.absent ? null : troubleOf(drive)
		const down = !!member && (drive.absent || member.responding === false)
		return {
			id: drive.id,
			drive,
			tone: down ? 'missing' : !member ? 'out' : trouble ? 'warning' : 'in',
			note: drive.absent
				? t('storage-mgr.drive.missing')
				: down
					? t('storage-start.drive.not-responding')
					: !member
						? t('storage-start.drive.other')
						: trouble
							? troubleNote(t, trouble)
							: undefined,
		}
	})

	const lead =
		members.length === 0 || members.some(unsure)
			? t('storage-start.lead.unknown')
			: silent.length === 0
				? t(`storage-start.lead.responding.${noun}`)
				: t(`storage-start.lead.missing.${noun}`, {count: silent.length, total: members.length})

	return (
		<div className='flex min-h-0 flex-1 flex-col'>
			<div
				className={cn(
					'flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto lg:gap-10 two-up:flex-row two-up:overflow-hidden two-up:max-lg:gap-6 one-up:[mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]',
					isPro && '-mr-4 md:-mr-6',
				)}
			>
				<div
					className={cn(
						'flex min-w-0 shrink-0 flex-col gap-5 lg:w-[440px] two-up:overflow-y-auto two-up:pt-4 two-up:pr-1 two-up:pl-2 two-up:max-lg:w-[52%]',
						'two-up:[mask-image:linear-gradient(to_bottom,black_calc(100%-20px),transparent)] two-up:pb-5',
						isPro && 'one-up:pr-4',
					)}
				>
					<StepHeader title={t(unconfirmed ? 'storage-start.unconfirmed.title' : 'storage-start.title')}>
						{loading
							? undefined
							: unconfirmed
								? t('storage-start.unconfirmed.body')
								: `${lead} ${t('storage-start.consequence')}`}
					</StepHeader>

					{loading ? (
						<div className='min-h-40' aria-busy='true' aria-label={t('loading')} />
					) : unconfirmed ? (
						checkError && (
							<Disclosure summary={t('storage-ui.technical-details')}>
								<code className='text-12 break-words text-white/55'>{checkError}</code>
							</Disclosure>
						)
					) : (
						<>
							{checkError && (
								<div role='alert' className='flex flex-col gap-2'>
									<Note tone='warning'>{t('storage-start.check-failed')}</Note>
									<Disclosure summary={t('storage-ui.technical-details')}>
										<code className='text-12 break-words text-white/55'>{checkError}</code>
									</Disclosure>
								</div>
							)}

							<div className='flex flex-col gap-2'>
								<SectionLabel className='px-1'>{t('storage-start.try')}</SectionLabel>
								<Rows>
									<Row
										label={t('restart')}
										hint={t('storage-start.restart.hint')}
										trailingBelow
										trailing={
											<Button size='md' className={rowButton} disabled={busy} onClick={() => setDialog('restart')}>
												{t('restart')}
											</Button>
										}
									/>
									<Row
										label={t(`storage-start.check.${noun}`)}
										hint={t(isPro ? 'storage-start.check.hint.pro' : 'storage-start.check.hint.other')}
										trailingBelow
										trailing={
											<Button size='md' className={rowButton} disabled={busy} onClick={() => setDialog('shutdown')}>
												{t('shut-down')}
											</Button>
										}
									/>
								</Rows>
							</div>

							{silent.length > 0 && <Note>{t('storage-start.note.failed')}</Note>}

							<div className='flex flex-col gap-2'>
								<SectionLabel className='px-1'>{t('storage-start.last')}</SectionLabel>
								<Rows>
									<Row
										label={t('storage-start.reset.label')}
										hint={t('storage-start.reset.hint')}
										trailingBelow
										trailing={
											<Button
												size='md'
												variant='destructive'
												className={rowButton}
												disabled={busy}
												onClick={() => setDialog('reset')}
											>
												{t('factory-reset')}
											</Button>
										}
									/>
								</Rows>
							</div>
						</>
					)}
				</div>

				{/* The drives the storage is built from, and which of them answered */}
				{!loading && !unconfirmed && views.length > 0 && (
					<PictureSide isPro={isPro}>
						<StorageArt device={device} drives={views} onPick={setInfoId} />
					</PictureSide>
				)}
			</div>

			<div className='mt-5 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5 two-up:px-2'>
				{footerStart ?? <span />}
				<button {...primaryButtonProps} disabled={checking || busy} onClick={onCheckAgain}>
					{t('storage-status.check-again')}
				</button>
			</div>

			<SheetRoot
				open={dialog === 'restart' || dialog === 'reset'}
				onOpenChange={(isOpen) => !isOpen && setDialog(null)}
			>
				<SheetContent>
					<SheetHeader>
						<SheetTitle>
							{t(dialog === 'reset' ? 'storage-start.reset.title' : 'storage-start.restart.title')}
						</SheetTitle>
						<SheetDescription>
							{t(dialog === 'reset' ? 'storage-start.reset.body' : 'storage-start.restart.body')}
						</SheetDescription>
					</SheetHeader>
					<SheetFooter>
						<Button
							variant={dialog === 'reset' ? 'destructive' : 'primary'}
							size='dialog'
							disabled={busy}
							onClick={() => {
								const confirmed = dialog
								setDialog(null)
								if (confirmed === 'reset') onFactoryReset()
								else onRestart()
							}}
						>
							{t(dialog === 'reset' ? 'factory-reset' : 'restart')}
						</Button>
						<Button size='dialog' onClick={() => setDialog(null)}>
							{t('cancel')}
						</Button>
					</SheetFooter>
				</SheetContent>
			</SheetRoot>

			<ShutDownDialog
				isPro={isPro}
				ssd={noun === 'ssd'}
				open={dialog === 'shutdown'}
				onOpenChange={(isOpen) => !isOpen && setDialog(null)}
				onShutdown={onShutdown}
				reason='storage'
			/>

			<SheetRoot open={!!info} onOpenChange={(isOpen) => !isOpen && setInfoId(null)}>
				{info && (
					<SheetContent>
						<SheetHeader>
							<SheetTitle>{driveTitle(t, info.drive)}</SheetTitle>
						</SheetHeader>
						<DriveBanner
							drive={info.drive}
							tone={views.find((view) => view.id === info.drive.id)?.tone ?? 'in'}
							note={views.find((view) => view.id === info.drive.id)?.note}
						/>
						<DriveFacts
							drive={info.drive}
							unit={temperatureUnit}
							use={unsure(info) ? undefined : t(info.member ? 'storage-ui.use.storage' : 'storage-ui.use.none')}
							status={
								info.drive.absent
									? t('storage-mgr.drive.missing')
									: info.member?.responding === false
										? t('storage-start.drive.not-responding')
										: undefined
							}
							statusTone={info.drive.absent || info.member?.responding === false ? 'critical' : undefined}
						/>
						<TemperatureAdvice drive={info.drive} isPro={isPro} />
						<SheetFooter>
							<Button size='dialog' onClick={() => setInfoId(null)}>
								{t('done')}
							</Button>
						</SheetFooter>
					</SheetContent>
				)}
			</SheetRoot>
		</div>
	)
}
