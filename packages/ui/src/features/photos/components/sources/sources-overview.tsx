import {MoreHorizontal, Plus} from 'lucide-react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {Card} from '@/components/ui/card'
import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'
import {ScrollArea} from '@/components/ui/scroll-area'
import {contextMenuClasses} from '@/components/ui/shared/menu'
import {SourceIcon} from '@/features/photos/components/sources/source-icon'
import {timeAgo} from '@/features/photos/components/sources/source-status'
import {useRemoveSource} from '@/features/photos/components/sources/use-remove-source'
import {sourcePath} from '@/features/photos/constants'
import {usePhotoSources, type PhotoSource} from '@/features/photos/hooks/use-photo-sources'
import {DockSpacer} from '@/modules/desktop/dock'
import {useLinkToDialog} from '@/utils/dialog'
import {formatNumberI18n} from '@/utils/number'

// /photos/sources: every source as a tile, like Files' cloud accounts view. A
// tile opens the source's timeline; the corner "⋯" and the context menu manage it.
export function SourcesOverview() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const {sources, isLoading} = usePhotoSources()

	return (
		// The one Photos page still on a card (by choice). Its height budget runs
		// to the sheet's bottom edge beneath the dock (mobile: the stack above is
		// ListingSurface's --page-top + 112, or + 56 on a phone on its side — see its height note); on desktop the box
		// starts 12px under the actions bar, which sits 10px below the sheet's
		// top edge (see ListingSurface).
		<div className='flex h-[calc(100dvh-var(--sheet-top)-var(--page-top)-112px)] flex-col lg:mt-(--umbrel-photos-drop) lg:h-[calc(100vh-146px-var(--umbrel-photos-drop))] phone-side:h-[calc(100dvh-var(--sheet-top)-var(--page-top)-56px)]'>
			<Card className='relative min-h-0 flex-1 rounded-24 bg-white/4 !p-0'>
				<ScrollArea className='h-full'>
					<div className='grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-4 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] lg:p-5'>
						{!isLoading &&
							sources.map((source) => (
								<SourceTile
									key={source.id}
									source={source}
									onOpen={() => navigate(sourcePath(source.id))}
									onManage={() => navigate(linkToDialog('photos-source', {id: source.id}))}
								/>
							))}
						<button
							type='button'
							onClick={() => navigate(linkToDialog('photos-add-source'))}
							className='flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 p-4 text-white/50 transition-colors hover:border-white/30 hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:outline-hidden'
						>
							<span className='flex size-10 items-center justify-center rounded-full bg-white/10'>
								<Plus className='size-5' />
							</span>
							<span className='text-13 font-medium'>{t('photos-sources.add')}</span>
						</button>
					</div>
					{/* The card runs beneath the dock: room for the last row to clear it */}
					<DockSpacer />
				</ScrollArea>
			</Card>
		</div>
	)
}

function SourceTile({source, onOpen, onManage}: {source: PhotoSource; onOpen: () => void; onManage: () => void}) {
	const {t, i18n} = useTranslation()
	const {remove} = useRemoveSource()

	return (
		<ContextMenu>
			<div className='group relative'>
				<ContextMenuTrigger asChild>
					<button
						type='button'
						onClick={onOpen}
						className='flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-2xl border border-transparent bg-white/5 px-3 py-4 text-center transition-colors hover:border-white/6 hover:bg-white/8 focus-visible:border-white/10 focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:outline-hidden'
					>
						<SourceIcon type={source.type} size={44} />
						<span className='mt-2 w-full truncate text-13 font-medium'>{source.name}</span>
						<span className='text-12 text-white/40'>
							{t('photos-sources.tile-items', {
								count: source.stats.photos + source.stats.videos,
								formattedCount: formatNumberI18n({
									n: source.stats.photos + source.stats.videos,
									showDecimals: false,
									locale: i18n.language,
								}),
							})}
						</span>
						{/* Reserved even when there's no backup yet (the umbrel source never has one),
						    so the centered tiles in a row keep their icons at the same height */}
						<span className='text-12 text-white/40'>
							{source.lastImportAt ? timeAgo(source.lastImportAt, i18n.language) : '\u00A0'}
						</span>
					</button>
				</ContextMenuTrigger>
				<button
					type='button'
					aria-label={t('photos-source.manage')}
					onClick={onManage}
					className='absolute top-1.5 right-1.5 rounded-full p-1.5 text-white/60 opacity-0 transition-colors group-hover:opacity-100 hover:bg-white/10 hover:text-white focus:outline-hidden focus-visible:bg-white/10 focus-visible:opacity-100 max-lg:opacity-100'
				>
					<MoreHorizontal className='size-4' />
				</button>
			</div>
			<ContextMenuContent>
				<ContextMenuItem onClick={onManage}>{t('photos-source.manage')}</ContextMenuItem>
				{source.type !== 'umbrel' && (
					<ContextMenuItem className={contextMenuClasses.item.rootDestructive} onClick={() => remove(source)}>
						{t('photos-source.remove')}
					</ContextMenuItem>
				)}
			</ContextMenuContent>
		</ContextMenu>
	)
}
