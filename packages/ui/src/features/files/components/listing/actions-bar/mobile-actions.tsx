import {CircleCheck, Plus, Search} from 'lucide-react'
import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useTranslation} from 'react-i18next'

import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {PillButton} from '@/components/ui/edge-controls'
import {useActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {useFilesSearch} from '@/features/files/hooks/use-files-search'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {cn} from '@/lib/utils'

// CircleCheck's ring sits inset within its viewBox, so at the pills' shared
// size-4 it reads a step smaller than its neighbours; drawn a touch larger
// it sits optically equal (as in Photos)
function SelectGlyph({className}: {className?: string}) {
	return <CircleCheck className={cn(className, 'size-[18px]')} />
}

// On phones and tablets the page's controls live in the title row, in the
// room to the right of "Files", exactly where Photos keeps its own: add,
// select, search, each a glyph. Nothing can be hovered or dragged over on a
// touch screen, so selecting starts from a button here; while selecting, the
// selection's actions take the bar's row and these step aside.
export function MobileActions({className}: {className?: string}) {
	const {t} = useTranslation()
	const reduceMotion = useReducedMotion() ?? false
	const {actions = [], hideSearch, selectable = true, hidePath, summary} = useActionsBarConfig()
	const isReadOnly = useIsFilesReadOnly()
	const isTouchDevice = useIsTouchDevice()
	const search = useFilesSearch()
	const isSelecting = useFilesStore((state) => state.isSelectingOnMobile)
	const setIsSelecting = useFilesStore((state) => state.setIsSelectingOnMobile)

	const offered = isReadOnly ? [] : actions.filter((action) => !action.desktopOnly)
	// Something that can't be done right now (nothing to paste) isn't worth a row on a phone
	const available = offered.filter((action) => !action.disabled)
	const [only] = offered

	return (
		<AnimatePresence initial={false}>
			{!isSelecting && (
				<motion.div
					key='page'
					className={cn('flex items-center gap-2', className)}
					initial={reduceMotion ? false : {opacity: 0, y: -4}}
					animate={{opacity: 1, y: 0}}
					exit={reduceMotion ? undefined : {opacity: 0, y: -4}}
					transition={{duration: 0.2, ease: [0.215, 0.61, 0.355, 1]}}
				>
					{offered.length === 1 ? (
						// A page with one thing to do wears it as its own glyph
						<PillButton icon={only.icon} aria-label={only.label} disabled={only.disabled} onClick={only.onSelect} />
					) : offered.length > 1 ? (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<PillButton icon={Plus} aria-label={t('files-action.add')} disabled={available.length === 0} />
							</DropdownMenuTrigger>
							<DropdownMenuContent align='end' className='min-w-52'>
								{available.map((action) => (
									<DropdownMenuItem key={action.id} onSelect={action.onSelect} className='gap-3 py-2.5'>
										<action.icon className='size-[18px] shrink-0 text-white/60' />
										{action.label}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
					{/* The same circled check a selected item wears */}
					{/* (Not where there is nothing to select, nor with a pointer, which
					    selects with a click) */}
					{isTouchDevice && selectable && !isReadOnly && !hidePath && summary?.count !== 0 && (
						<PillButton icon={SelectGlyph} aria-label={t('files-action.select')} onClick={() => setIsSelecting(true)} />
					)}
					{/* Opens the title-row search (MobileSearch in FilesLayout) */}
					{search && !hideSearch && !isReadOnly && (
						<PillButton icon={Search} aria-label={t('files-search.placeholder')} onClick={() => search.setOpen(true)} />
					)}
				</motion.div>
			)}
		</AnimatePresence>
	)
}
