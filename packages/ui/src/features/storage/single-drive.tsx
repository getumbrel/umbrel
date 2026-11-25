// Storage Manager on a machine that keeps everything on the drive it starts from: Umbrel
// Home, Raspberry Pi, other hardware set up without storage drives, and containers. There is
// nothing to manage, so its job is to say whether that one drive is all right, how full it is,
// why FailSafe isn't here, and what to do instead.
//
// Also the window shown when Storage Manager can't read the storage at all.

import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {hostEnvironmentMap} from '@/constants'
import externalStorage from '@/features/files/assets/external-storage-icon.png'
import {cn} from '@/lib/utils'

import {DriveSlab, DriveTone, StatusBadge, StatusTone} from './art'
import {DriveFacts, TemperatureAdvice, TemperatureUnit} from './drive-facts'
import {UsbDrives, UsbDrivesProps} from './manager/shared'
import {Drive, formatSize, GB, Trouble, troubleOf} from './model'
import {
	ActionButton,
	Disclosure,
	DriveBanner,
	DriveLine,
	Note,
	Row,
	Rows,
	SectionLabel,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetRoot,
	SheetTitle,
	Steps,
	Window,
} from './parts'
import {driveTitle, troubleNote} from './phrases'
import {getSingleStatus, SingleHost} from './single-status'
import {NEARLY_FULL} from './state'

export type {SingleHost} from './single-status'

const formatAmount = (bytes: number) =>
	bytes < 1000 * GB ? `${Math.max(1, Math.round(bytes / GB))}GB` : formatSize(bytes)

const statusSurface: Record<StatusTone, string> = {
	protected: 'border-transparent bg-white/5',
	unprotected: 'border-transparent bg-white/5',
	healthy: 'border-transparent bg-white/5',
	busy: 'border-transparent bg-white/5',
	attention: 'border-[#F5A623]/30 bg-[#F5A623]/[0.07]',
	critical: 'border-[#FF3434]/35 bg-[#FF3434]/[0.08]',
}

type Sheet = {type: 'failsafe'} | {type: 'move'} | {type: 'drive'; id: string} | null

export function SingleDriveManager({
	host,
	drive,
	others = [],
	usage,
	usageFailed,
	onRetryUsage,
	usb,
	onOpenBackups,
	onViewUsage,
	onClose,
	temperatureUnit = 'c',
	supportUrl,
	downloadUrl,
}: {
	host: SingleHost
	// The drive umbrelOS runs from, when umbreld can see it. It can't see microSD cards, USB
	// drives or a container's folder.
	drive?: Drive
	// Other drives inside the machine, which this setup can't use
	others?: Drive[]
	usage?: {total: number; used: number}
	usageFailed?: boolean
	onRetryUsage?: () => void
	usb?: UsbDrivesProps
	onOpenBackups: () => void
	// Where space can be freed up: what is using it
	onViewUsage?: () => void
	onClose: () => void
	temperatureUnit?: TemperatureUnit
	supportUrl?: string
	// Where umbrelOS can be downloaded, to set up again on other drives
	downloadUrl?: string
}) {
	const {t} = useTranslation()
	const [sheet, setSheet] = useState<Sheet>(null)
	const trouble = drive ? troubleOf(drive) : null
	const full = usage && usage.total > 0 ? Math.min(1, usage.used / usage.total) : 0
	const nearlyFull = full >= NEARLY_FULL
	const isHome = host === 'home'
	// Other hardware can have storage of its own. The rest have one drive, or none of their own.
	const canMove = host === 'other'
	const everyDrive = [...(drive ? [drive] : []), ...others]
	const sheetDrive = sheet?.type === 'drive' ? everyDrive.find((candidate) => candidate.id === sheet.id) : undefined
	const support = isHome && supportUrl ? supportUrl : undefined

	const status = getSingleStatus({host, drive, usage, canViewUsage: !!onViewUsage, t})

	const driveTone = (candidate: Drive, own: boolean): DriveTone =>
		troubleOf(candidate) ? 'warning' : own ? 'in' : 'out'
	const noteOf = (candidate: Drive) => {
		const candidateTrouble = troubleOf(candidate)
		return candidateTrouble ? troubleNote(t, candidateTrouble) : undefined
	}

	return (
		<>
			<Window title={t('storage-manager')} onClose={onClose}>
				<div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-8 two-up:max-lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] two-up:max-lg:gap-x-6'>
					<div className='flex min-w-0 flex-col gap-5'>
						<section
							className={cn(
								'flex flex-col gap-4 rounded-24 border p-5 transition-colors duration-500',
								statusSurface[status.tone],
							)}
						>
							<div className='flex items-start gap-4'>
								<StatusBadge tone={status.tone} />
								<div className='flex min-w-0 flex-1 flex-col gap-1'>
									<h2 aria-live='polite' className='text-[19px] leading-tight font-semibold text-white'>
										{status.title}
									</h2>
									<p className='text-14 leading-snug text-white/60'>{status.body}</p>
									{(status.action || (support && trouble)) && (
										<div className='mt-2 flex flex-wrap gap-2'>
											{status.action === 'backups' && (
												<ActionButton variant='primary' onClick={onOpenBackups}>
													{t('storage-mgr.action.backups')}
												</ActionButton>
											)}
											{status.action === 'drive' && drive && (
												<ActionButton onClick={() => setSheet({type: 'drive', id: drive.id})}>
													{t(`storage-mgr.action.view.${drive.kind === 'ssd' ? 'ssd' : 'drive'}`)}
												</ActionButton>
											)}
											{status.action === 'usage' && onViewUsage && (
												<ActionButton variant='primary' onClick={onViewUsage}>
													{t('storage-single.action.usage')}
												</ActionButton>
											)}
											{support && trouble && (
												<ActionButton asChild>
													<a href={support} target='_blank' rel='noreferrer'>
														{t('storage-ui.contact-support')}
													</a>
												</ActionButton>
											)}
										</div>
									)}
								</div>
							</div>

							<div className='flex flex-col gap-2 border-t border-white/[0.07] pt-4'>
								{usage ? (
									<>
										<div className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-13 text-white/50'>
											<span className='font-medium text-white/85'>
												{t('storage-mgr.used', {used: formatAmount(usage.used)})}
											</span>
											<span>
												{t('storage-mgr.free-of', {
													free: formatAmount(Math.max(0, usage.total - usage.used)),
													total: formatAmount(usage.total),
												})}
											</span>
										</div>
										<div className='flex h-2 w-full overflow-hidden rounded-full bg-white/10' aria-hidden>
											<div
												className={cn(
													'h-full rounded-full transition-[width] duration-500 ease-out',
													nearlyFull ? 'bg-[#F5A623]' : 'bg-white/85',
												)}
												style={{width: `${full * 100}%`}}
											/>
										</div>
									</>
								) : usageFailed ? (
									<div className='flex flex-wrap items-center justify-between gap-3 text-13 text-white/50'>
										<span role='alert'>{t('storage-single.usage-unavailable')}</span>
										{onRetryUsage && (
											<Button size='sm' onClick={onRetryUsage}>
												{t('try-again')}
											</Button>
										)}
									</div>
								) : (
									<div className='h-[34px]' aria-busy='true' aria-label={t('loading')} />
								)}
							</div>
						</section>

						{others.length > 0 && (
							<section className='flex flex-col gap-3 rounded-17 bg-white/5 p-4'>
								<div className='flex flex-col gap-0.5'>
									<h2 className='text-15 font-semibold text-white'>
										{t('storage-single.others.title', {count: others.length})}
									</h2>
									<p className='text-13 leading-snug text-white/60'>{t(`storage-single.others.body.${host}`)}</p>
								</div>
								<div className='flex flex-col divide-y divide-white/[0.06] rounded-12 bg-white/5'>
									{others.map((other) => (
										<button
											key={other.id}
											type='button'
											onClick={() => setSheet({type: 'drive', id: other.id})}
											className='text-left outline-hidden transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset'
										>
											<DriveLine drive={other} tone={driveTone(other, false)} className='min-h-[52px]' />
										</button>
									))}
								</div>
								{canMove && (
									<div>
										<ActionButton onClick={() => setSheet({type: 'move'})}>
											{t('storage-single.action.move')}
										</ActionButton>
									</div>
								)}
							</section>
						)}

						<Rows>
							<Row
								label={t('storage-ui.failsafe')}
								value={t(canMove ? 'storage-single.failsafe.not-set-up' : 'storage-single.failsafe.unavailable')}
								onClick={() => setSheet({type: 'failsafe'})}
							/>
							{host !== 'container' && (
								<Row label={t('backups')} hint={t('storage-single.backups.hint')} onClick={onOpenBackups} />
							)}
						</Rows>

						{usb && <UsbDrives {...usb} />}
					</div>

					{/* What everything is kept on */}
					<div className='flex min-w-0 flex-col items-center gap-3 lg:w-[360px]'>
						{isHome && (
							<img src='/assets/onboarding/home-front.webp' alt='' draggable={false} className='w-full max-w-[320px]' />
						)}
						{host === 'container' ? (
							<div className='flex w-full flex-col items-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-6 py-10 text-white/50'>
								{/* The mark Device info shows for a container */}
								<img
									src={hostEnvironmentMap['docker-container'].icon}
									alt=''
									draggable={false}
									className='size-[72px] object-contain'
								/>
								<span className='text-center text-13'>{t('storage-single.container.folder')}</span>
							</div>
						) : drive ? (
							<div className='w-full rounded-[20px] border border-white/10 bg-white/[0.04] p-2'>
								<DriveSlab
									view={{id: drive.id, drive, tone: driveTone(drive, true), note: noteOf(drive)}}
									onPick={(id) => setSheet({type: 'drive', id})}
								/>
							</div>
						) : (
							!isHome && (
								<div className='flex w-full flex-col items-center gap-2 rounded-[20px] border border-white/10 bg-white/[0.04] px-6 py-8'>
									<img src={externalStorage} alt='' draggable={false} className='h-16 w-[70px] object-contain' />
									{usage && <span className='text-17 font-bold text-white'>{formatAmount(usage.total)}</span>}
									<span className='text-center text-12 text-white/50'>{t('storage-single.boot-storage')}</span>
								</div>
							)
						)}
					</div>
				</div>
			</Window>

			<SheetRoot open={sheet !== null} onOpenChange={(isOpen) => !isOpen && setSheet(null)}>
				{sheet && (
					<SheetContent>
						{sheet.type === 'failsafe' && (
							<>
								<SheetHeader>
									<SheetTitle>{t(`storage-single.failsafe.title.${host}`)}</SheetTitle>
									<SheetDescription>{t(`storage-single.failsafe.body.${host}`)}</SheetDescription>
								</SheetHeader>
								<SheetFooter>
									{canMove ? (
										<Button variant='primary' size='dialog' onClick={() => setSheet({type: 'move'})}>
											{t('storage-mgr.action.set-up-failsafe')}
										</Button>
									) : (
										host !== 'container' && (
											<Button variant='primary' size='dialog' onClick={onOpenBackups}>
												{t('storage-mgr.action.backups')}
											</Button>
										)
									)}
									<Button size='dialog' onClick={() => setSheet(null)}>
										{t('done')}
									</Button>
								</SheetFooter>
							</>
						)}

						{sheet.type === 'move' && (
							<>
								<SheetHeader>
									<SheetTitle>{t('storage-single.move.title')}</SheetTitle>
									<SheetDescription>{t('storage-single.move.body')}</SheetDescription>
								</SheetHeader>
								<Steps
									steps={[
										t('storage-single.move.1'),
										t('storage-single.move.2'),
										t('storage-single.move.3'),
										t('storage-single.move.4'),
									]}
								/>
								{others.some((other) => other.kind === 'ssd') && others.some((other) => other.kind === 'hdd') && (
									<Note>{t('storage-single.move.mixed')}</Note>
								)}
								<SheetFooter>
									<Button variant='primary' size='dialog' onClick={onOpenBackups}>
										{t('storage-mgr.action.backups')}
									</Button>
									{downloadUrl && (
										<Button size='dialog' asChild>
											<a href={downloadUrl} target='_blank' rel='noreferrer'>
												{t('storage-single.move.download')}
											</a>
										</Button>
									)}
									<Button size='dialog' onClick={() => setSheet(null)}>
										{t('done')}
									</Button>
								</SheetFooter>
							</>
						)}

						{sheet.type === 'drive' && sheetDrive && (
							<>
								<SheetHeader>
									<SheetTitle>{driveTitle(t, sheetDrive)}</SheetTitle>
								</SheetHeader>
								<DriveBanner
									drive={sheetDrive}
									tone={driveTone(sheetDrive, sheetDrive.id === drive?.id)}
									note={noteOf(sheetDrive)}
								/>
								<DriveFacts
									drive={sheetDrive}
									unit={temperatureUnit}
									use={t(sheetDrive.id === drive?.id ? 'storage-single.use' : 'storage-ui.use.none')}
									status={statusOf(troubleOf(sheetDrive), t)}
									statusTone={
										troubleOf(sheetDrive) === 'critical' ? 'critical' : troubleOf(sheetDrive) ? 'attention' : undefined
									}
								/>
								<TemperatureAdvice drive={sheetDrive} isPro={false} />
								<SheetFooter>
									<Button size='dialog' onClick={() => setSheet(null)}>
										{t('done')}
									</Button>
								</SheetFooter>
							</>
						)}
					</SheetContent>
				)}
			</SheetRoot>
		</>
	)
}

const statusOf = (trouble: Trouble | null, t: ReturnType<typeof useTranslation>['t']) =>
	trouble ? t(`storage-mgr.state.${trouble}`) : undefined

// ---------------------------------------------------------------------------
// When the storage can't be read
// ---------------------------------------------------------------------------

// Storage Manager with nothing it can vouch for: umbreld didn't answer, or it answered with a
// storage that can't be made sense of. It shows the drives it can see and nothing it would
// have to guess.
export function StorageUnreadable({
	reason,
	detail,
	drives = [],
	loading,
	retrying,
	onRetry,
	onClose,
	temperatureUnit = 'c',
}: {
	// 'no-answer': the requests failed. 'unidentified': the storage isn't running, or what it is
	// built from couldn't be worked out.
	reason: 'no-answer' | 'unidentified'
	// umbreld's own words
	detail?: string
	// Whatever drives could be listed, each with what is known of its part in the storage
	drives?: {drive: Drive; role?: string; state?: string}[]
	loading?: boolean
	retrying?: boolean
	onRetry: () => void
	onClose: () => void
	temperatureUnit?: TemperatureUnit
}) {
	const {t} = useTranslation()
	const [infoId, setInfoId] = useState<string | null>(null)
	const info = drives.find((entry) => entry.drive.id === infoId)
	return (
		<>
			<Window title={t('storage-manager')} onClose={onClose} narrow>
				{loading ? (
					<div className='h-56' aria-busy='true' aria-label={t('loading')} />
				) : (
					<>
						<section className='flex flex-col gap-4 rounded-24 border border-[#F5A623]/30 bg-[#F5A623]/[0.07] p-5'>
							<div className='flex items-start gap-4'>
								<StatusBadge tone='attention' />
								<div className='flex min-w-0 flex-1 flex-col gap-1'>
									<h2 className='text-[19px] leading-tight font-semibold text-white'>
										{t(`storage-single.unreadable.${reason}.title`)}
									</h2>
									<p className='text-14 leading-snug text-white/60'>{t(`storage-single.unreadable.${reason}.body`)}</p>
									<div className='mt-2'>
										<ActionButton variant='primary' disabled={retrying} onClick={onRetry}>
											{t('storage-status.check-again')}
										</ActionButton>
									</div>
								</div>
							</div>
						</section>
						{drives.length > 0 && (
							<div className='flex flex-col gap-1.5'>
								<SectionLabel className='px-1.5 text-12'>{t('storage-single.unreadable.drives')}</SectionLabel>
								<Rows>
									{drives.map(({drive, role, state}) => (
										<button
											key={drive.id}
											type='button'
											onClick={() => setInfoId(drive.id)}
											className='text-left outline-hidden transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-inset'
										>
											{/* What part the drive plays sits beside it, or under it where the window is too
											    narrow for both */}
											<DriveLine
												drive={drive}
												slot={drive.slot}
												tone={drive.absent ? 'missing' : troubleOf(drive) ? 'warning' : 'in'}
												className='@container'
												below={
													(role || state) && (
														<span className='@[340px]:hidden'>
															{role}
															{role && state && ' - '}
															{state && <span className='font-medium text-white/75'>{state}</span>}
														</span>
													)
												}
												trailing={
													(role || state) && (
														<span className='hidden shrink-0 flex-col items-end text-12 leading-snug text-white/50 @[340px]:flex'>
															{role && <span>{role}</span>}
															{state && <span className='font-medium text-white/75'>{state}</span>}
														</span>
													)
												}
											/>
										</button>
									))}
								</Rows>
							</div>
						)}
						{detail && (
							<Disclosure summary={t('storage-ui.technical-details')}>
								<code className='text-12 break-words text-white/55'>{detail}</code>
							</Disclosure>
						)}
					</>
				)}
			</Window>

			<SheetRoot open={!!info} onOpenChange={(isOpen) => !isOpen && setInfoId(null)}>
				{info && (
					<SheetContent>
						<SheetHeader>
							<SheetTitle>{driveTitle(t, info.drive)}</SheetTitle>
						</SheetHeader>
						<DriveBanner
							drive={info.drive}
							slot={info.drive.slot}
							tone={info.drive.absent ? 'missing' : troubleOf(info.drive) ? 'warning' : 'in'}
						/>
						<DriveFacts
							drive={info.drive}
							unit={temperatureUnit}
							use={info.role ?? t('storage-ui.use.none')}
							status={info.drive.absent ? t('storage-mgr.drive.missing') : info.state}
							statusTone={info.drive.absent ? 'critical' : undefined}
						/>
						<TemperatureAdvice drive={info.drive} isPro={false} />
						<SheetFooter>
							<Button size='dialog' onClick={() => setInfoId(null)}>
								{t('done')}
							</Button>
						</SheetFooter>
					</SheetContent>
				)}
			</SheetRoot>
		</>
	)
}
