import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import {motion, useReducedMotion} from 'motion/react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbChevronRight, TbInfoCircle, TbX} from 'react-icons/tb'

import {AppIcon} from '@/components/app-icon'
import {Switch} from '@/components/ui/switch'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip'
import {FolderIcon} from '@/features/files/components/shared/file-item-icon/folder-icon'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {AccountAvatar} from '@/modules/auth/account-avatar'
import {OWNER_USER_ID} from '@/modules/auth/constants'
import {trpcReact} from '@/trpc/trpc'

// Shared building blocks for the user-sharing surfaces: the users settings
// dialog and the folder/app share dialogs opened from context menus.

// Whether any member accounts exist — sharing surfaces are hidden without them
export function useHasMembers() {
	const accountsQ = trpcReact.user.listAccounts.useQuery()
	return (accountsQ.data ?? []).some((account) => account.userId !== OWNER_USER_ID)
}

// Share lists cap at ~3.5 rows and scroll so dialogs don't grow unbounded.
export const shareListClass = () => cn('max-h-[196px] divide-y divide-white/6 overflow-y-auto rounded-12 bg-white/6')

// Compact share-all control that sits in a section header next to the Add
// button: small switch, label, and the helper copy tucked into an info tooltip
export function ShareAllToggle({
	label,
	tooltip,
	checked,
	disabled,
	onCheckedChange,
	className,
}: {
	label: string
	tooltip: string
	checked: boolean
	disabled?: boolean
	onCheckedChange: (checked: boolean) => void
	className?: string
}) {
	// Controlled so the info icon also opens on click/tap — Radix tooltips
	// otherwise only respond to hover, which reads as broken on touch
	const [tooltipOpen, setTooltipOpen] = useState(false)
	return (
		<div className={cn('flex h-[25px] items-center gap-1.5', className)}>
			<label className='flex cursor-pointer items-center gap-2'>
				<Switch className='scale-90' checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
				<span className='text-13 font-medium -tracking-2 whitespace-nowrap text-white/90'>{label}</span>
			</label>
			<Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen} delayDuration={150}>
				<TooltipTrigger asChild>
					<button
						type='button'
						onClick={() => setTooltipOpen((open) => !open)}
						className='rounded-full text-white/30 transition-colors hover:text-white/60 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white/20'
					>
						<TbInfoCircle className='size-3.5' />
					</button>
				</TooltipTrigger>
				{/* Portaled so the dialog's overflow doesn't clip it */}
				<TooltipPrimitive.Portal>
					<TooltipContent
						side='top'
						collisionPadding={12}
						className='z-50 max-w-60 rounded-8 border-hpx border-white/10 px-3 py-2 text-center text-12 leading-snug text-white/90 shadow-xl [--tooltip-background:var(--color-neutral-800)]'
					>
						{tooltip}
					</TooltipContent>
				</TooltipPrimitive.Portal>
			</Tooltip>
		</div>
	)
}

// Full-width switch row with title + helper copy, used as the "share with
// everyone" card in the folder/app share dialogs
export function ShareEveryoneRow({
	title,
	description,
	checked,
	disabled,
	onCheckedChange,
	className,
}: {
	title: string
	description: string
	checked: boolean
	disabled?: boolean
	onCheckedChange: (checked: boolean) => void
	className?: string
}) {
	return (
		<label className={cn('flex items-center justify-between gap-4 py-1', className)}>
			<div className='min-w-0 flex-1'>
				<div className='text-13 font-medium -tracking-2 text-white/90'>{title}</div>
				<div className='text-12 leading-tight text-white/35'>{description}</div>
			</div>
			<Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
		</label>
	)
}

// Inline grant summary shown at the trailing edge of list rows: an
// overlapping app-icon stack or a folder icon, plus a short count label.
// Icons hide on mobile where the rows are tighter.
export function GrantSummary({
	icons,
	folder,
	label,
}: {
	icons?: (string | undefined)[]
	folder?: boolean
	label: string
}) {
	const isMobile = useIsMobile()
	return (
		<span className='flex shrink-0 items-center gap-1.25 text-12 text-white/60'>
			{!isMobile && folder && <FolderIcon className='h-6 w-7' />}
			{!isMobile && !!icons?.length && (
				<span className='flex -space-x-3'>
					{icons.slice(0, 3).map((src, index) => (
						<AppIcon key={index} size={24} src={src} className='relative rounded-6' style={{zIndex: 3 - index}} />
					))}
				</span>
			)}
			{label}
		</span>
	)
}

// Trailing chevron for drill-in list rows; nudges right when the row (a
// `group` element) is hovered
export function RowChevron() {
	return (
		<TbChevronRight className='-mx-0.5 size-4 shrink-0 text-white/20 transition-transform group-hover:translate-x-0.5' />
	)
}

// Remove control at the end of a share-list row (granted app/folder)
export function RowRemoveButton({label, onClick, disabled}: {label: string; onClick: () => void; disabled?: boolean}) {
	return (
		<button
			type='button'
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className='rounded-full p-1.5 text-white/30 transition-colors hover:bg-white/10 hover:text-white/70 disabled:pointer-events-none disabled:opacity-40'
		>
			<TbX className='size-4' />
		</button>
	)
}

// Height-animated wrapper for share-list rows entering/leaving inside an
// AnimatePresence. With reorder on, rows also glide to their new slot when the
// list re-sorts around them — position-only, so the glide never fights the
// height animation.
export function AnimatedRow({children, reorder = false}: {children: React.ReactNode; reorder?: boolean}) {
	const reducedMotion = useReducedMotion() ?? false
	return (
		<motion.div
			layout={reorder ? 'position' : undefined}
			initial={{opacity: 0, height: 0}}
			animate={{opacity: 1, height: 'auto'}}
			exit={{opacity: 0, height: 0}}
			transition={{duration: reducedMotion ? 0 : 0.2}}
			className='overflow-hidden'
		>
			{children}
		</motion.div>
	)
}

export function EmptyCard({children}: {children: React.ReactNode}) {
	return (
		<div className='grid min-h-16 place-items-center rounded-12 bg-white/6 px-4 py-5 text-center text-13 text-white/40'>
			{children}
		</div>
	)
}

// The body shared by the folder and app share dialogs: an "everyone" toggle
// plus per-member switches. Calls onChange with the new sharedWith value; an
// empty selection means unshare.
export function MemberSharePicker({
	sharedWith,
	isBusy,
	onChange,
	lockedReason,
}: {
	sharedWith: 'all' | string[] | undefined
	isBusy: boolean
	onChange: (sharedWith: 'all' | string[]) => void
	// Members who already have access through a broader grant (share-all or an
	// ancestor folder). Their rows render as on + disabled with the returned
	// text as a tooltip explaining where the real control lives.
	lockedReason?: (member: {userId: string; name: string}) => string | undefined
}) {
	const {t} = useTranslation()
	const accountsQ = trpcReact.user.listAccounts.useQuery()
	const members = (accountsQ.data ?? []).filter((account) => account.userId !== OWNER_USER_ID)

	const everyone = sharedWith === 'all'
	const selectedUserIds = Array.isArray(sharedWith) ? sharedWith : []
	// Also disabled until accounts resolve: turning "everyone" off materializes
	// to the member list, which would wrongly unshare while it's still empty
	const disabled = isBusy || !accountsQ.data

	const toggleUser = (userId: string) => {
		onChange(
			selectedUserIds.includes(userId) ? selectedUserIds.filter((id) => id !== userId) : [...selectedUserIds, userId],
		)
	}

	return (
		<>
			<ShareEveryoneRow
				className='rounded-12 bg-white/6 p-3'
				title={t('users.share-with-everyone')}
				description={t('users.share-with-everyone-description')}
				checked={everyone}
				disabled={disabled}
				// Turning everyone off materializes to the current members so nobody
				// loses access until they're unchecked individually
				onCheckedChange={(checked) => onChange(checked ? 'all' : members.map((member) => member.userId))}
			/>

			{!everyone && (
				<div className='flex flex-col gap-2'>
					<div className='text-13 font-medium -tracking-2 text-white/90'>{t('users.share-specific-members')}</div>
					{members.length > 0 ? (
						<div className={shareListClass()}>
							{members.map((member) => {
								const locked = lockedReason?.(member)
								// A label so the whole row toggles the switch; a locked row has
								// nothing to toggle
								const Row = locked ? 'div' : 'label'
								return (
									<Row
										key={member.userId}
										className={cn(
											'flex items-center gap-3 p-3',
											!locked && 'cursor-pointer transition-colors hover:bg-white/4',
										)}
									>
										<AccountAvatar name={member.name} userId={member.userId} avatarUrl={member.avatarUrl} size={28} />
										<span className='min-w-0 flex-1 truncate text-14 font-medium -tracking-2 text-white/90'>
											{member.name}
										</span>
										{locked ? (
											<LockedSwitch tooltip={locked} />
										) : (
											<Switch
												checked={selectedUserIds.includes(member.userId)}
												disabled={disabled}
												onCheckedChange={() => toggleUser(member.userId)}
											/>
										)}
									</Row>
								)
							})}
						</div>
					) : (
						accountsQ.data && <EmptyCard>{t('users.no-members')}</EmptyCard>
					)}
				</div>
			)}
		</>
	)
}

// An on + disabled switch wrapped in a dark tooltip. Disabled elements don't
// emit pointer events, so the wrapper span is the trigger; controlled so a
// tap also opens it on touch.
function LockedSwitch({tooltip}: {tooltip: string}) {
	const [open, setOpen] = useState(false)
	return (
		<Tooltip open={open} onOpenChange={setOpen} delayDuration={150}>
			<TooltipTrigger asChild>
				<span className='inline-flex' onClick={() => setOpen((open) => !open)}>
					<Switch checked disabled className='disabled:opacity-60' />
				</span>
			</TooltipTrigger>
			<TooltipContent
				side='top'
				collisionPadding={12}
				className='z-50 max-w-60 rounded-8 border-hpx border-white/10 px-3 py-2 text-center text-12 leading-snug text-white/90 shadow-xl [--tooltip-background:var(--color-neutral-800)]'
			>
				{tooltip}
			</TooltipContent>
		</Tooltip>
	)
}
