import {useEffect} from 'react'
import {Outlet} from 'react-router-dom'

import {DesktopContent} from '@/components/desktop/desktop-content'
import {DesktopContextMenu} from '@/components/desktop/desktop-misc'
import {Dock, DockBottomPositioner} from '@/components/desktop/dock'
import {EnsureLoggedIn} from '@/components/ensure-logged-in'
import {Wallpaper} from '@/components/wallpaper-context'
import {InstalledAppsProvider} from '@/hooks/use-installed-apps'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'

export function Desktop() {
	useUmbrelTitle('Desktop')

	// Prevent scrolling on the desktop because it interferes with `AppGridGradientMasking` and causes tearing effect
	useEffect(() => {
		document.documentElement.style.overflow = 'hidden'
		return () => {
			document.documentElement.style.overflow = ''
		}
	}, [])

	return (
		<EnsureLoggedIn>
			<InstalledAppsProvider>
				<DesktopContextMenu>
					<Wallpaper />
					<div
						className={
							// `relative` positioning keeps children above <Wallpaper /> since that element is positioned `fixed`
							'relative flex h-[100dvh] w-full flex-col items-center justify-between overflow-hidden'
						}
					>
						<DesktopContent />
						<Outlet />
					</div>
				</DesktopContextMenu>
				<DockBottomPositioner>
					<Dock />
				</DockBottomPositioner>
			</InstalledAppsProvider>
		</EnsureLoggedIn>
	)
}
