import {motion, MotionConfig} from 'framer-motion'
import {useId, useState} from 'react'

import {FlameIcon} from '@/features/files/assets/flame-icon'
import {Droppable} from '@/features/files/components/shared/drag-and-drop'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {TRASH_PATH} from '@/features/files/constants'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useListDirectory} from '@/features/files/hooks/use-list-directory'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useConfirmation} from '@/providers/confirmation'
import {Button} from '@/shadcn-components/ui/button'
import {t} from '@/utils/i18n'

export function SidebarTrash() {
	const {navigateToDirectory, currentPath} = useNavigate()
	const isTrash = currentPath === TRASH_PATH
	const [isHovering, setIsHovering] = useState(false)
	const {listing} = useListDirectory(TRASH_PATH, {
		itemsOnScrollEnd: 3,
		initialItems: 3,
	})
	const isTrashEmpty = listing?.items?.length === 0
	const {emptyTrash} = useFilesOperations()
	const confirm = useConfirmation()
	const id = useId()
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
		} catch (error) {
			// User cancelled
		}
	}

	return (
		<MotionConfig transition={{duration: 0.2, ease: [0.29, 0.01, 0, 1]}}>
			<Droppable
				className='mr-4 flex flex-col rounded-xl'
				dropOverClassName='border border-brand'
				id='sidebar-trash'
				path={TRASH_PATH}
				disabled={isTrash}
				navigateToPath={false}
				onMouseEnter={(e: React.MouseEvent) => {
					/* Exclude hover when user is dropping files */
					if (e.buttons === 0) {
						setIsHovering(true)
					}
				}}
				onMouseLeave={() => setIsHovering(false)}
			>
				{(isReadyToDrop) => {
					const isExpanded = (isReadyToDrop || (isHovering && !isTrash)) && !isMobile
					return (
						<motion.div
							layout
							className={`flex flex-col items-center ${
								isExpanded
									? 'rounded-xl border border-white/6 bg-gradient-to-b from-white/[0.04] to-white/[0.08] p-3'
									: 'h-[35px] cursor-pointer rounded-lg'
							} ${isTrash && 'border-white/6 bg-gradient-to-b !from-white/[0.04] !to-white/[0.08] shadow-button-highlight-soft-hpx'}`}
							initial={false}
							onClick={() => {
								if (isMobile) {
									navigateToDirectory(TRASH_PATH)
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
									className={`text-12 text-white/60 ${isExpanded ? 'mb-2' : 'ml-[-18px] mt-[10px]'}`}
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

								{/* Trash SVG */}
								<motion.div
									layout='position'
									className={`${isExpanded ? 'mt-4' : 'ml-[-16px] mt-[-18px]'} flex-shrink-0`}
									animate={{
										scale: isExpanded ? 1 : 0.3,
									}}
									initial={false}
								>
									<svg className='mt-0 overflow-visible' width='70' height='74' viewBox='0 0 70 74' fill='none'>
										<path
											d='M69.4114 5.10535C69.4114 7.37914 53.8764 9.22241 34.713 9.22241C15.5496 9.22241 0.0146484 7.37914 0.0146484 5.10535C0.0146484 2.83155 15.5496 0.988281 34.713 0.988281C53.8764 0.988281 69.4114 2.83155 69.4114 5.10535Z'
											fill={`url(#gradient-1-${id})`}
											fillOpacity='0.4'
											filter={`url(#glow-${id})`}
										/>
										<path
											d='M69.4114 5.10535C69.4114 7.37914 53.8764 9.22241 34.713 9.22241C15.5496 9.22241 0.0146484 7.37914 0.0146484 5.10535C0.0146484 2.83155 15.5496 0.988281 34.713 0.988281C53.8764 0.988281 69.4114 2.83155 69.4114 5.10535Z'
											fill='black'
											fillOpacity='0.7'
										/>
										<g id={`files-${id}`}>
											{listing?.items[2] && (
												<g
													transform-origin='50% 50%'
													transform={
														listing?.items[2].type === 'directory'
															? `translate(16,-28) rotate(-70) scale(0.75)`
															: 'translate(12,-22) rotate(18) scale(0.7)'
													}
												>
													<FileItemIcon item={listing.items[2]} onlySVG />
												</g>
											)}
											{listing?.items[1] && (
												<g
													transform-origin='50% 50%'
													transform={
														listing?.items[1].type === 'directory'
															? `translate(10,-28) rotate(-80) scale(0.75)`
															: 'translate(6,-18) rotate(10) scale(0.8)'
													}
													filter={listing?.items[2] && 'url(#file-shadow)'}
												>
													<FileItemIcon item={listing.items[1]} onlySVG />
												</g>
											)}
											{listing?.items[0] && (
												<g
													transform-origin='50% 50%'
													transform={
														listing?.items[0].type === 'directory'
															? `translate(2,-24) rotate(-90) scale(0.75)`
															: 'translate(0,-10) rotate(-2)'
													}
													filter={listing?.items[1] && `url(#file-shadow-${id})`}
												>
													<FileItemIcon item={listing.items[0]} onlySVG />
												</g>
											)}
										</g>
										<g filter={`url(#glow-${id})`}>
											<path
												d='M0.0146484 5.10535L2.58973 5.52427C23.8653 8.98642 45.5607 8.98642 66.8363 5.52426L69.4114 5.10535L58.0067 61.4707C56.4969 68.9328 49.9379 74.2976 42.3245 74.2976H27.1015C19.4881 74.2976 12.9292 68.9328 11.4193 61.4707L0.0146484 5.10535Z'
												fill={`url(#gradient-2-${id})`}
												fillOpacity='0.4'
											/>
											<path
												d='M0.0146484 5.10535L2.58973 5.52427C23.8653 8.98642 45.5607 8.98642 66.8363 5.52426L69.4114 5.10535L58.0067 61.4707C56.4969 68.9328 49.9379 74.2976 42.3245 74.2976H27.1015C19.4881 74.2976 12.9292 68.9328 11.4193 61.4707L0.0146484 5.10535Z'
												fill={`url(#gradient-3-${id})`}
												fillOpacity='0.7'
											/>
											<path
												d='M0.0146484 5.10535L2.58973 5.52427C23.8653 8.98642 45.5607 8.98642 66.8363 5.52426L69.4114 5.10535L58.0067 61.4707C56.4969 68.9328 49.9379 74.2976 42.3245 74.2976H27.1015C19.4881 74.2976 12.9292 68.9328 11.4193 61.4707L0.0146484 5.10535Z'
												fill='black'
												fillOpacity='0.2'
											/>
										</g>
										<g style={{clipPath: `url(#clip-${id})`}}>
											<use xlinkHref={`#files-${id}`} filter={`url(#blur-${id})`} />
										</g>
										<clipPath id={`clip-${id}`}>
											<path d='M0.0146484 5.10535L2.58973 5.52427C23.8653 8.98642 45.5607 8.98642 66.8363 5.52426L69.4114 5.10535L58.0067 61.4707C56.4969 68.9328 49.9379 74.2976 42.3245 74.2976H27.1015C19.4881 74.2976 12.9292 68.9328 11.4193 61.4707L0.0146484 5.10535Z' />
										</clipPath>
										<defs>
											<filter id={`blur-${id}`} width='160%' height='200%' x='-30%'>
												<feGaussianBlur in='SourceGraphic' stdDeviation='4' result='blur' />
												<feColorMatrix type='saturate' in='blur' result='dimmed' values='0.4' />
												<feComponentTransfer in='dimmed' result='output'>
													<feFuncR type='linear' slope='0.2' intercept='0' />
													<feFuncG type='linear' slope='0.2' intercept='0' />
													<feFuncB type='linear' slope='0.2' intercept='0' />
													<feFuncA type='linear' slope='1' intercept='0' />
												</feComponentTransfer>
											</filter>
											<filter id={`file-shadow-${id}`}>
												<feOffset in='SourceAlpha' dx='2' dy='-10' />
												<feGaussianBlur stdDeviation='6' />
												<feBlend in='SourceGraphic' in2='blurOut' />
											</filter>
											<filter id={`glow-${id}`} filterUnits='userSpaceOnUse' colorInterpolationFilters='sRGB'>
												<feFlood floodOpacity='0' result='BackgroundImageFix' />
												<feGaussianBlur in='BackgroundImageFix' stdDeviation='3' />
												<feComposite in2='SourceAlpha' operator='in' result='effect1_backgroundBlur_897_3007' />
												<feBlend
													mode='normal'
													in='SourceGraphic'
													in2='effect1_backgroundBlur_897_3007'
													result='shape'
												/>
												<feColorMatrix
													in='SourceAlpha'
													type='matrix'
													values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
													result='hardAlpha'
												/>
												<feOffset dx='0.5' dy='0.5' />
												<feGaussianBlur stdDeviation='0.5' />
												<feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
												<feColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0' />
												<feBlend mode='normal' in2='shape' result='effect2_innerShadow_897_3007' />
											</filter>
											<linearGradient
												id={`gradient-1-${id}`}
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
											<linearGradient
												id={`gradient-2-${id}`}
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
												id={`gradient-3-${id}`}
												x1='34.713'
												y1='5.10547'
												x2='34.713'
												y2='74.2978'
												gradientUnits='userSpaceOnUse'
											>
												<stop stopOpacity='0' />
												<stop offset='0.815' />
											</linearGradient>
											<linearGradient
												id={`gradient-4-${id}`}
												x1='34.713'
												y1='5.10547'
												x2='34.713'
												y2='74.2978'
												gradientUnits='userSpaceOnUse'
											>
												<stop stopColor='#959595' stopOpacity='0' />
												<stop offset='1' stopColor='#A3A3A3' stopOpacity='0.06' />
											</linearGradient>
										</defs>
									</svg>
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
												<Button variant='default' onClick={() => navigateToDirectory(TRASH_PATH)}>
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
