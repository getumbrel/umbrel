import {useEffect} from 'react'

import {CmdkMenu, useCmdkOpen} from '@/components/cmdk'
import {useApps} from '@/hooks/use-apps'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {DefaultCredentialsDialog} from '@/modules/app-store/app-page/default-credentials-dialog'
import {DesktopContent} from '@/modules/desktop/desktop-content'
import {DesktopContextMenu} from '@/modules/desktop/desktop-context-menu'
import {AppGridGradientMasking} from '@/modules/desktop/desktop-misc'
import {InstallFirstApp} from '@/modules/desktop/install-first-app'

export function Desktop() {
	const {userApps, isLoading} = useApps()

	if (isLoading) {
		return null
	}

	if (userApps?.length === 0) {
		return <InstallFirstAppPage />
	}

	return <DesktopPage />
}

function InstallFirstAppPage() {
	const title = 'Install your first app'
	useUmbrelTitle(title)

	return <InstallFirstApp title={title} />
}

function DesktopPage() {
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
				<div
					className={
						// `relative` positioning keeps children above <Wallpaper /> since that element is positioned `fixed`
						'relative flex h-[100dvh] w-full flex-col items-center justify-between'
					}
				>
					<DesktopContent onSearchClick={() => setOpen(true)} />
				</div>
			</DesktopContextMenu>
			{/* NOTE:
        Keep `AppGridGradientMasking` here rather than deeper down in component heirarchy to avoid being animated up and down when widget selector opens and closes.
      */}
			<AppGridGradientMasking />
			<BlurBelowDock />
			<CmdkMenu open={open} setOpen={setOpen} />
			<DefaultCredentialsDialog />
		</>
	)
}

const BlurBelowDock = () => (
	<div
		className='pointer-events-none fixed inset-0 top-0 backdrop-blur-2xl delay-500 duration-500 animate-in fade-in fill-mode-both'
		style={{
			background: '#00000044',
			WebkitMaskImage: 'linear-gradient(transparent calc(100% - 300px), black calc(100% - 30px))',
		}}
	/>
)
