import {motion, MotionConfig} from 'motion/react'
import {useId, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {FlameIcon} from '@/features/files/assets/flame-icon'
import {Droppable} from '@/features/files/components/shared/drag-and-drop'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useTrashPath} from '@/features/files/hooks/use-home-path'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import type {FileSystemItem} from '@/features/files/types'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {useConfirmation} from '@/providers/confirmation'

export function SidebarTrash() {
	const {t} = useTranslation()
	const {navigateToDirectory, currentPath} = useNavigate()
	const trashPath = useTrashPath()
	const isTrash = currentPath === trashPath
	const [isHovering, setIsHovering] = useState(false)
	// The can shows what went in last: newest first is the closest the listing
	// gets to "most recently trashed"
	const {listing} = useListDirectory(trashPath, {
		itemsOnScrollEnd: PILE_SLOTS.length,
		initialItems: PILE_SLOTS.length,
		sortBy: 'modified',
		sortOrder: 'descending',
	})
	const items = listing?.items ?? []
	const isTrashEmpty = items.length === 0
	const {emptyTrash} = useFilesOperations()
	const confirm = useConfirmation()
	const isMobile = useIsMobile()

	const handleEmptyTrash = async () => {
		if (isTrashEmpty) return
		try {
			await confirm({
				title: t('files-empty-trash.title'),
				message: t('files-empty-trash.description'),
				actions: [
					{label: t('files-empty-trash.confirm'), value: 'confirm', variant: 'destructive'},
					{label: t('cancel'), value: 'cancel', variant: 'default'},
				],
				icon: FlameIcon,
			})
			emptyTrash()
		} catch {
			// User cancelled
		}
	}

	return (
		<MotionConfig transition={{duration: 0.2, ease: [0.29, 0.01, 0, 1]}}>
			<Droppable
				className='mr-4 flex flex-col rounded-xl'
				dropOverClassName='border border-brand'
				id='sidebar-trash'
				path={trashPath}
				disabled={isTrash}
				navigateToPath={false}
				onMouseEnter={(e: React.MouseEvent) => {
					/* Exclude hover when user is dropping files */
					if (e.buttons === 0) {
						const rect = e.currentTarget.getBoundingClientRect()
						/* Collapsed row height is ~35px. Ignore mouseenter if cursor is below the collapsed row during collapse transition */
						if (!isHovering && e.clientY > rect.top + 38) {
							return
						}
						setIsHovering(true)
					}
				}}
				onMouseLeave={(e: React.MouseEvent) => {
					const rect = e.currentTarget.getBoundingClientRect()
					if (
						e.clientX < rect.left ||
						e.clientX >= rect.right ||
						e.clientY < rect.top ||
						e.clientY >= rect.bottom
					) {
						setIsHovering(false)
					}
				}}
			>
				{(isReadyToDrop) => {
					const isExpanded = (isReadyToDrop || (isHovering && !isTrash)) && !isMobile
					return (
						// overflow-hidden keeps the hover surface honest: the collapsed row
						// positions the can with negative margins, and without the clip its
						// layout box reached below the row, so a cursor just under it would
						// expand the card, land outside the expanded content, collapse it,
						// and repeat. Now the collapsed row is always inside the expanded card.
						<motion.div
							layout
							className={cn(
								'flex flex-col items-center overflow-hidden',
								isExpanded
									? 'rounded-xl border border-white/6 bg-linear-to-b from-white/[0.04] to-white/[0.08] p-3'
									: 'h-[35px] rounded-lg',
								isTrash &&
									'border-white/6 bg-linear-to-b !from-white/[0.04] !to-white/[0.08] shadow-button-highlight-soft-hpx',
							)}
							initial={false}
							onClick={() => {
								if (isMobile) {
									navigateToDirectory(trashPath)
								}
							}}
						>
							<motion.div
								layout='position'
								className={`flex justify-end ${isExpanded ? 'flex-col items-center' : 'w-full flex-row-reverse'}`}
							>
								{/* "Trash" text */}
								<motion.div
									layout='position'
									className={`text-12 text-white/60 ${isExpanded ? 'mb-2' : 'mt-[10px] ml-[-18px]'}`}
								>
									{t('files-sidebar.trash')}
								</motion.div>

								{isExpanded && !isHovering && (
									<span className='mt-0 flex opacity-70'>
										<svg width='32' height='17' viewBox='0 0 32 17' fill='none'>
											<path
												d='M13.4956 10.3327L8.82894 14.9993L4.16227 10.3327L6.82894 10.3327C6.82894 2.33268 3.49561 1.66602 3.49561 1.66602C3.49561 1.66602 10.8289 2.33268 10.8289 10.3327L13.4956 10.3327Z'
												fill='#3C3C3C'
											/>
											<path
												d='M20.68848 10.3327L25.35514 14.9993L30.0218 10.3327L27.35514 10.3327C27.35514 2.33268 30.6885 1.66602 30.6885 1.66602C30.6885 1.66602 23.35514 2.33268 23.35514 10.3327L20.68848 10.3327Z'
												fill='#3C3C3C'
											/>
										</svg>
									</span>
								)}

								{/* The can */}
								<motion.div
									layout='position'
									className={`${isExpanded ? 'mt-4' : 'mt-[-18px] ml-[-16px]'} flex-shrink-0`}
									animate={{
										scale: isExpanded ? 1 : 0.3,
									}}
									initial={false}
								>
									<TrashCan items={items} />
								</motion.div>
							</motion.div>

							{isExpanded && (
								<>
									{isHovering && (
										<motion.div
											className='mt-4 h-px w-full bg-[radial-gradient(80%_50%_at_50%_50%,rgba(255,255,255,0.35)_0%,transparent_70%)]'
											initial={{scaleX: 0, opacity: 0}}
											animate={{scaleX: 1, opacity: 1}}
										/>
									)}
									<motion.div className='mt-4 flex gap-2' initial={{y: 10, opacity: 0}} animate={{y: 0, opacity: 1}}>
										{isHovering && (
											<>
												<Button variant='default' onClick={() => navigateToDirectory(trashPath)}>
													{t('files-sidebar.trash.open')}
												</Button>
												<Button
													onClick={handleEmptyTrash}
													variant='default'
													disabled={isTrashEmpty}
													className={isTrashEmpty ? 'pointer-events-none opacity-50' : ''}
												>
													<FlameIcon />
												</Button>
											</>
										)}
									</motion.div>
								</>
							)}
						</motion.div>
					)
				}}
			</Droppable>
		</MotionConfig>
	)
}

// ---

// The can is a 70×74 stage drawn at 1:1, so its SVG paths double as CSS clip paths.
const CAN_WIDTH = 70
const CAN_HEIGHT = 74
const RIM_PATH =
	'M69.4114 5.10535C69.4114 7.37914 53.8764 9.22241 34.713 9.22241C15.5496 9.22241 0.0146484 7.37914 0.0146484 5.10535C0.0146484 2.83155 15.5496 0.988281 34.713 0.988281C53.8764 0.988281 69.4114 2.83155 69.4114 5.10535Z'
const BODY_PATH =
	'M0.0146484 5.10535L2.58973 5.52427C23.8653 8.98642 45.5607 8.98642 66.8363 5.52426L69.4114 5.10535L58.0067 61.4707C56.4969 68.9328 49.9379 74.2976 42.3245 74.2976H27.1015C19.4881 74.2976 12.9292 68.9328 11.4193 61.4707L0.0146484 5.10535Z'

// Where the last few trashed items sit, front to back: a loose pile that
// pokes out above the rim. The newest item takes the front slot.
const PILE_SLOTS = [
	{left: 12, top: -16, size: 46, rotate: -4},
	{left: 4, top: -22, size: 44, rotate: -16},
	{left: 26, top: -24, size: 42, rotate: 14},
]

/**
 * The trash can with its contents. The items are ordinary file icons — folders,
 * type icons, image thumbnails — laid on top of the opening so their tops poke
 * out, then covered by the translucent body, and finally drawn once more on top
 * of the body, blurred and dimmed and cut to its shape, as the silhouette seen
 * through the can.
 */
function TrashCan({items}: {items: FileSystemItem[]}) {
	const id = useId()

	return (
		<div className='relative' style={{width: CAN_WIDTH, height: CAN_HEIGHT}}>
			{/* The opening */}
			<svg className='absolute inset-0 overflow-visible' width={CAN_WIDTH} height={CAN_HEIGHT} fill='none'>
				<path d={RIM_PATH} fill={`url(#trash-rim-${id})`} fillOpacity='0.4' />
				<path d={RIM_PATH} fill='black' fillOpacity='0.7' />
				<path d={RIM_PATH} fill='none' stroke='white' strokeOpacity='0.08' strokeWidth='0.5' />
				<defs>
					<linearGradient
						id={`trash-rim-${id}`}
						x1='0.0146484'
						y1='37.6429'
						x2='69.4114'
						y2='37.643'
						gradientUnits='userSpaceOnUse'
					>
						<stop stopColor='#2D2D2D' />
						<stop offset='0.487377' stopColor='#3F3F3F' />
						<stop offset='1' stopColor='#272727' />
					</linearGradient>
				</defs>
			</svg>

			<TrashPile items={items} />

			{/* The body */}
			<svg className='absolute inset-0 overflow-visible' width={CAN_WIDTH} height={CAN_HEIGHT} fill='none'>
				<path d={BODY_PATH} fill={`url(#trash-body-${id})`} fillOpacity='0.4' />
				<path d={BODY_PATH} fill={`url(#trash-shade-${id})`} fillOpacity='0.7' />
				<path d={BODY_PATH} fill='black' fillOpacity='0.2' />
				<path d={BODY_PATH} fill='none' stroke='white' strokeOpacity='0.08' strokeWidth='0.5' />
				<defs>
					<linearGradient
						id={`trash-body-${id}`}
						x1='-1.98535'
						y1='39.7017'
						x2='71.4114'
						y2='39.7017'
						gradientUnits='userSpaceOnUse'
					>
						<stop stopColor='#787878' />
						<stop offset='0.330518' stopColor='#797979' />
						<stop offset='1' stopColor='#262626' />
					</linearGradient>
					<linearGradient
						id={`trash-shade-${id}`}
						x1='34.713'
						y1='5.10547'
						x2='34.713'
						y2='74.2978'
						gradientUnits='userSpaceOnUse'
					>
						<stop stopOpacity='0' />
						<stop offset='0.815' />
					</linearGradient>
				</defs>
			</svg>

			{/* The pile seen through the body */}
			<TrashPile
				items={items}
				style={{clipPath: `path('${BODY_PATH}')`, filter: 'blur(4px) saturate(0.4) brightness(0.2)'}}
			/>
		</div>
	)
}

function TrashPile({items, style}: {items: FileSystemItem[]; style?: React.CSSProperties}) {
	// Assign slots newest-first, then draw back to front so the newest ends up on top
	const pile = items
		.slice(0, PILE_SLOTS.length)
		.map((item, index) => ({item, slot: PILE_SLOTS[index]}))
		.reverse()

	return (
		<div aria-hidden className='pointer-events-none absolute inset-0' style={style}>
			{pile.map(({item, slot}) => (
				<div
					key={item.path}
					className='absolute'
					style={{left: slot.left, top: slot.top, width: slot.size, height: slot.size, rotate: `${slot.rotate}deg`}}
				>
					<FileItemIcon item={item} className='size-full object-contain' />
				</div>
			))}
		</div>
	)
}
