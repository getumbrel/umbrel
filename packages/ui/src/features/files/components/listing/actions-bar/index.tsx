import {useTranslation} from 'react-i18next'
import {HiMenuAlt2} from 'react-icons/hi'

import {Separator} from '@/components/ui/separator'
import {useActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {MobileActions, SelectToggle} from '@/features/files/components/listing/actions-bar/mobile-actions'
import {NavigationControls} from '@/features/files/components/listing/actions-bar/navigation-controls'
import {PathBar} from '@/features/files/components/listing/actions-bar/path-bar'
import {SearchInput} from '@/features/files/components/listing/actions-bar/search-input'
import {SortDropdown} from '@/features/files/components/listing/actions-bar/sort-dropdown'
import {ViewToggle} from '@/features/files/components/listing/actions-bar/view-toggle'
import {useIsFilesEmbedded, useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {cn} from '@/lib/utils'
import {touchTargetClass} from '@/utils/element-classes'

// Actions/navigation bar displayed above every files listing.  Its
// contents are driven by the configuration exposed via the
// <ActionsBarProvider /> (see actions-bar-context.tsx).
export function ActionsBar({onOpenSidebar}: {onOpenSidebar?: () => void}) {
	const {t} = useTranslation()
	const {hidePath, pathLabel, hideSearch, desktopActions, mobileActions, mobilePrimaryAction} = useActionsBarConfig()
	const isReadOnly = useIsFilesReadOnly()
	const isEmbedded = useIsFilesEmbedded()
	const showSearchUi = !hideSearch && !isReadOnly
	const showViewToggleUi = isEmbedded || !isReadOnly
	const showSortUi = isEmbedded || !isReadOnly

	return (
		<nav
			className={cn(
				// The window's close button sits at this row's end on a phone on its side
				'flex h-8 w-full min-w-0 gap-3 phone-side:pr-9',
				!isEmbedded && 'lg:-mt-11 panes:-mt-11 phone-side:mt-0',
			)}
			aria-label={t('files-view.actions')}
		>
			{/* Left side: Navigation and Path. Clipped sideways only, so the buttons' touch targets reach past the 32px row */}
			<div className='flex min-w-0 flex-1 items-center gap-2 overflow-x-clip'>
				{onOpenSidebar && (
					<button
						type='button'
						onClick={onOpenSidebar}
						aria-label={t('files-sidebar.navigation')}
						// The padding past the glyph keeps Back's touch target off it
						className={cn(touchTargetClass, 'hidden shrink-0 px-1 phone-side:block')}
					>
						<HiMenuAlt2 className='h-5 w-5 text-white/90' />
					</button>
				)}
				<NavigationControls />
				{hidePath ? null : pathLabel ? <span className='truncate text-xs opacity-70'>{pathLabel}</span> : <PathBar />}
			</div>

			{/* Right side: View Controls and Actions */}
			<div className='ml-auto flex items-center'>
				{/* Desktop view - show toggle for view and separate buttons for each action */}
				<div className='hidden items-center gap-2 lg:flex'>
					{desktopActions && !isReadOnly ? (
						<>
							{desktopActions}
							<Separator orientation='vertical' className='h-6' />
						</>
					) : null}
					{/* Search */}
					{showSearchUi ? <SearchInput /> : null}
					{showViewToggleUi ? <ViewToggle /> : null}
					{showSortUi ? <SortDropdown /> : null}
					{/* Fingers can't drag a marquee or hold Shift, so a tablet needs this too */}
					{!mobilePrimaryAction && !isReadOnly ? <SelectToggle className='hidden pointer-coarse:inline-flex' /> : null}
				</div>

				{/* Tablets and phones - show menu with all actions */}
				<div className='lg:hidden'>
					<MobileActions DropdownItems={!isReadOnly ? mobileActions : null} />
				</div>
			</div>
		</nav>
	)
}
