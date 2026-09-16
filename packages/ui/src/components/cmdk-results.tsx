import {ChevronRight} from 'lucide-react'
import {useTranslation} from 'react-i18next'

import {AppIcon} from '@/components/app-icon'
import {CommandItem, CommandList} from '@/components/ui/command'
import {ItemThumbnail} from '@/features/photos/components/listing/item-thumbnail'
import {cn} from '@/lib/utils'
import {HttpUrlAuthorizerProvider} from '@/modules/auth/http-url-authorizer'

import {cmdkMoreValue, type CmdkItem, type CmdkResults, type CmdkSection} from './cmdk-sources'

const PLACEHOLDER_TILES = 6

export function CmdkResultsList({results, listRef}: {results: CmdkResults; listRef: React.Ref<HTMLDivElement>}) {
	const {t} = useTranslation()
	const {ready, sections, footer, empty} = results
	return (
		<CommandList ref={listRef} className='mt-3.5 max-h-[min(60dvh,540px)] scroll-py-2 pb-1' aria-busy={!ready}>
			{!ready ? null : sections.length === 0 ? (
				<div role='status' className='px-4 py-10 text-center text-13 -tracking-2 text-white/40'>
					{empty ?? t('no-results-found')}
				</div>
			) : (
				<div className='flex flex-col'>
					{sections.map((section, index) => (
						<Section key={section.id} section={section} first={index === 0} />
					))}
					{footer && (
						<div className='cmdk-section mt-3 px-2'>
							<CommandItem
								value={footer.value}
								onSelect={footer.onSelect}
								showShortcut={false}
								className='inline-flex w-auto gap-1.5 rounded-full bg-white/6 py-1.5 pr-2.5 pl-2 text-13 text-white/80 hover:bg-white/10 aria-selected:bg-white/12 aria-selected:text-white md:text-13'
							>
								{typeof footer.icon === 'string' && (
									<AppIcon src={footer.icon} size={20} className='rounded-[22%] border-0 bg-transparent' />
								)}
								{footer.title}
								<ChevronRight className='size-3.5 text-white/45' />
							</CommandItem>
						</div>
					)}
				</div>
			)}
		</CommandList>
	)
}

// Sections are keyed by id, so one that appears mid-search (a server search
// landing) rises in while the rest, and everything within them, changes in
// place without animation. The header comes last in the DOM and first on
// screen (`order-first`): cmdk selects the first item in DOM order when a
// search changes, and that should be the first result, not the header's
// "More" link.
function Section({section, first}: {section: CmdkSection; first: boolean}) {
	const {t} = useTranslation()
	return (
		<section
			className={cn('cmdk-section flex flex-col', !first && 'mt-3 border-t border-white/6 pt-3')}
			aria-label={section.title}
		>
			<SectionItems section={section} />
			{section.title && (
				<div className='order-first mb-1 flex h-7 items-center gap-2 pr-1 pl-2'>
					{section.icon && <AppIcon src={section.icon} size={22} className='rounded-[22%] border-0 bg-transparent' />}
					<span className='text-13 font-medium -tracking-2 text-white/75'>{section.title}</span>
					{section.more && (
						<CommandItem
							value={cmdkMoreValue(section.id)}
							onSelect={section.more}
							showShortcut={false}
							aria-label={t('cmdk.more-in', {section: section.title})}
							className='ml-auto gap-0.5 rounded-full py-1 pr-1.5 pl-2.5 text-12 text-white/50 hover:text-white/80 aria-selected:bg-white/10 aria-selected:text-white md:text-12'
						>
							{t('cmdk.more')}
							<ChevronRight className='size-3.5' />
						</CommandItem>
					)}
				</div>
			)}
		</section>
	)
}

function SectionItems({section}: {section: CmdkSection}) {
	if (section.layout === 'list') {
		return (
			<div className='cmdk-rows'>
				{section.items.map((item) => (
					<CommandItem
						key={item.value}
						value={item.value}
						icon={item.icon}
						iconVariant={item.iconVariant}
						disabled={item.disabled}
						onSelect={item.onSelect}
					>
						{/* One flex item, so the subtitle sits a text space away rather than a flex gap */}
						<span className='truncate'>
							{item.title}
							{item.subtitle && <span className='opacity-50'> {item.subtitle}</span>}
						</span>
					</CommandItem>
				))}
			</div>
		)
	}

	const placeholders = section.loading && section.items.length === 0
	const grid = (
		<div className='grid grid-cols-3 gap-1 sm:grid-cols-6'>
			{placeholders
				? Array.from({length: PLACEHOLDER_TILES}, (_, index) => (
						<div key={index} className='aspect-square animate-pulse rounded-12 bg-white/4' aria-hidden='true' />
					))
				: section.items.map((item) =>
						section.layout === 'photos' ? (
							<PhotoTile key={item.value} item={item} />
						) : (
							<Tile key={item.value} item={item} />
						),
					)}
		</div>
	)
	// Thumbnails carry the API token; one provider serves every tile
	return section.layout === 'photos' ? <HttpUrlAuthorizerProvider>{grid}</HttpUrlAuthorizerProvider> : grid
}

function Tile({item}: {item: CmdkItem}) {
	return (
		<CommandItem
			value={item.value}
			disabled={item.disabled}
			onSelect={item.onSelect}
			showShortcut={false}
			aria-label={item.title}
			className='flex-col gap-2 rounded-12 px-1.5 pt-3 pb-2.5 text-center hover:bg-white/4 aria-selected:bg-white/8 aria-selected:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]'
		>
			<span className='flex size-12 items-center justify-center'>
				{typeof item.icon === 'string' ? (
					<AppIcon src={item.icon} size={48} className='rounded-12' />
				) : (
					<span className='flex size-12 items-center justify-center'>{item.icon}</span>
				)}
			</span>
			<span className='w-full truncate text-12 leading-tight font-medium -tracking-2 text-white/80'>{item.title}</span>
		</CommandItem>
	)
}

function PhotoTile({item}: {item: CmdkItem}) {
	if (!item.photo) return null
	return (
		<CommandItem
			value={item.value}
			onSelect={item.onSelect}
			showShortcut={false}
			aria-label={item.title}
			className='rounded-10 p-[3px] aria-selected:bg-white/20'
		>
			<span className='relative block aspect-square w-full overflow-hidden rounded-8'>
				<ItemThumbnail item={item.photo} size={512} className='absolute inset-0' />
			</span>
		</CommandItem>
	)
}
