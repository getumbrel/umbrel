// import {SearchIcon} from '@/features/files/assets/search-icon'
import {useActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {MobileActions} from '@/features/files/components/listing/actions-bar/mobile-actions'
import {NavigationControls} from '@/features/files/components/listing/actions-bar/navigation-controls'
import {PathBar} from '@/features/files/components/listing/actions-bar/path-bar'
import {SortDropdown} from '@/features/files/components/listing/actions-bar/sort-dropdown'
import {ViewToggle} from '@/features/files/components/listing/actions-bar/view-toggle'
import {Separator} from '@/shadcn-components/ui/separator'

// Actions/navigation bar displayed above every files listing.  Its
// contents are driven by the configuration exposed via the
// <ActionsBarProvider /> (see actions-bar-context.tsx).
export function ActionsBar() {
	const {hidePath, desktopActions, mobileActions} = useActionsBarConfig()

	return (
		<nav className='flex h-8 w-full min-w-0 gap-3 lg:mt-[-3.5rem]' aria-label='File browser actions'>
			{/* Left side: Navigation and Path */}
			<div className='flex min-w-0 flex-1 items-center gap-2 overflow-hidden'>
				<NavigationControls />
				{hidePath ? null : <PathBar />}
			</div>

			{/* Right side: View Controls and Actions */}
			<div className='ml-auto flex items-center'>
				{/* Desktop view - show toggle for view and separate buttons for each action */}
				<div className='hidden items-center gap-2 md:flex'>
					{/* TODO: Add search here */}
					{/* <SearchIcon />
					<Separator orientation='vertical' className='h-6' /> */}
					{desktopActions ? (
						<>
							{desktopActions}
							<Separator orientation='vertical' className='h-6' />
						</>
					) : null}
					<ViewToggle />
					<SortDropdown />
				</div>

				{/* Mobile view - show menu with all actions */}
				<div className='md:hidden'>
					<MobileActions DropdownItems={mobileActions} />
				</div>
			</div>
		</nav>
	)
}
