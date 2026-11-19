import {ArrowDown, ArrowUp, ArrowUpDown, Check, SlidersHorizontal} from 'lucide-react'
import {useTranslation} from 'react-i18next'

import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {PillButton, PillButtonGroup} from '@/components/ui/edge-controls'
import {GridLayoutIcon} from '@/features/files/assets/grid-layout-icon'
import {ListLayoutIcon} from '@/features/files/assets/list-layout-icon'
import {SORT_BY_OPTIONS} from '@/features/files/constants'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import type {ViewPreferences} from '@/features/files/types'
import {cn} from '@/lib/utils'

// A menu section's name: quiet, above its items
const menuLabelClass = 'px-3 pt-2 pb-1 text-11 font-medium -tracking-2 text-white/40'

const VIEWS = [
	{view: 'list', labelTKey: 'files-view.list', icon: ListLayoutIcon},
	{view: 'icons', labelTKey: 'files-view.icons', icon: GridLayoutIcon},
] as const

// List or icons: two glyphs sharing one pill, the one in use lit in the
// accent the way the Photos timeline's grouping is
export function ViewToggle() {
	const {t} = useTranslation()
	const {preferences, setView} = usePreferences()
	const current = preferences?.view ?? 'list'

	return (
		<PillButtonGroup role='group' aria-label={t('files-view.view-as')}>
			{VIEWS.map(({view, labelTKey, icon: Icon}) => (
				<DarkTooltip key={view} label={t(labelTKey)} side='bottom'>
					<button
						type='button'
						aria-label={t(labelTKey)}
						aria-pressed={current === view}
						onClick={() => setView(view)}
						className={cn(
							'flex h-8 w-9 items-center justify-center rounded-full outline-hidden transition-[background-color,color] duration-200 focus-visible:ring-2 focus-visible:ring-white/25',
							current === view
								? 'bg-brand/45 text-white shadow-button-highlight-soft-hpx contrast-more:bg-brand/70 contrast-more:ring-1 contrast-more:ring-white contrast-more:ring-inset'
								: 'text-white/55 hover:bg-white/10 hover:text-white',
						)}
					>
						<Icon className='size-4' />
					</button>
				</DarkTooltip>
			))}
		</PillButtonGroup>
	)
}

// What the folder is ordered by. Choosing the one in use turns it round.
export function SortMenu() {
	const {t} = useTranslation()
	return (
		<DropdownMenu>
			<DarkTooltip label={t('files-view.sort-by')} side='bottom'>
				<DropdownMenuTrigger asChild>
					<PillButton icon={ArrowUpDown} aria-label={t('files-view.sort-by')} />
				</DropdownMenuTrigger>
			</DarkTooltip>
			<DropdownMenuContent align='end' className='min-w-44'>
				<SortItems />
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

// Phones and tablets: how the folder is shown and ordered, behind one glyph.
// On a phone it is a quiet one at the end of the title's row, with the page's
// own buttons in the row above. On a tablet those buttons stand beside it, and
// it is a pill as they are.
export function ViewOptionsButton({quiet = true}: {quiet?: boolean}) {
	const {t} = useTranslation()
	const {preferences, setView} = usePreferences()
	const current = preferences?.view ?? 'list'

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<PillButton
					icon={SlidersHorizontal}
					aria-label={t('files-view.options')}
					className={
						quiet
							? 'size-9 bg-transparent shadow-none [border:none] hover:bg-white/10 data-[state=open]:bg-white/10'
							: undefined
					}
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='min-w-48'>
				<DropdownMenuLabel className={menuLabelClass}>{t('files-view.view-as')}</DropdownMenuLabel>
				{VIEWS.map(({view, labelTKey, icon: Icon}) => (
					<DropdownMenuItem key={view} onSelect={() => setView(view)} className='gap-2.5 pointer-coarse:py-2.5'>
						<Icon className='size-4 shrink-0 text-white/60' />
						<span className='flex-1'>{t(labelTKey)}</span>
						{current === view && <Check className='size-4 shrink-0 text-white/60' aria-hidden />}
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				<SortItems />
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

function SortItems() {
	const {t} = useTranslation()
	const {preferences, setSortBy} = usePreferences()
	const Direction = preferences?.sortOrder === 'descending' ? ArrowDown : ArrowUp

	return (
		<>
			<DropdownMenuLabel className={menuLabelClass}>{t('files-view.sort-by')}</DropdownMenuLabel>
			{SORT_BY_OPTIONS.map((option) => {
				const isCurrent = option.sortBy === (preferences?.sortBy as ViewPreferences['sortBy'] | undefined)
				return (
					<DropdownMenuItem
						key={option.sortBy}
						// The menu stays open so a second choice of the same one can turn the order round
						onSelect={(event) => {
							event.preventDefault()
							setSortBy(option.sortBy)
						}}
						className='gap-2.5 pointer-coarse:py-2.5'
					>
						<span className='flex-1'>{t(option.labelTKey)}</span>
						{isCurrent && <Direction className='size-4 shrink-0 text-white/60' aria-hidden />}
					</DropdownMenuItem>
				)
			})}
		</>
	)
}
