import {Suspense, useEffect} from 'react'
import {Outlet} from 'react-router-dom'

import {CmdkMenu, useCmdkOpen} from '@/components/cmdk'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {DefaultCredentialsDialog} from '@/modules/app-store/app-page/default-credentials-dialog'
import {DesktopContent} from '@/modules/desktop/desktop-content'
import {AppGridGradientMasking, DesktopContextMenu} from '@/modules/desktop/desktop-misc'
import {Dock, DockBottomPositioner} from '@/modules/desktop/dock'
import {Wallpaper} from '@/modules/desktop/wallpaper-context'

export function Desktop() {
	useUmbrelTitle('Desktop')
	const {open, setOpen} = useCmdkOpen()

	// Prevent scrolling on the desktop because it interferes with `AppGridGradientMasking` and causes tearing effect
	useEffect(() => {
		document.documentElement.style.overflow = 'hidden'
		return () => {
			document.documentElement.style.overflow = ''
		}
	}, [])

	return (
		<>
			<DesktopContextMenu>
				<Wallpaper />
				<div
					className={
						// `relative` positioning keeps children above <Wallpaper /> since that element is positioned `fixed`
						'relative flex h-[100dvh] w-full flex-col items-center justify-between'
					}
				>
					<DesktopContent onSearchClick={() => setOpen(true)} />
				</div>
			</DesktopContextMenu>
			<Suspense>
				<Outlet />
			</Suspense>
			{/* NOTE:
        Keep `AppGridGradientMasking` here rather than deeper down in component heirarchy to avoid being animated up and down when widget selector opens and closes.
      */}
			<AppGridGradientMasking />
			<BlurBelowDock />
			<DockBottomPositioner>
				<Dock />
			</DockBottomPositioner>
			<CmdkMenu open={open} setOpen={setOpen} />
			<DefaultCredentialsDialog />
		</>
	)
}

const BlurBelowDock = () => (
	<div
		className='pointer-events-none fixed inset-0 top-0 backdrop-blur-2xl'
		style={{
			background: '#000000aa',
			WebkitMaskImage: 'linear-gradient(transparent calc(100% - 200px), black calc(100% - 30px))',
		}}
	/>
)
