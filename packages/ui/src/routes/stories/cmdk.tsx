import {CmdkMenu, useCmdkOpen} from '@/components/cmdk'
import {InstalledAppsProvider} from '@/hooks/use-installed-apps'
import {H1} from '@/layouts/stories'
import {Search} from '@/modules/desktop/desktop-misc'
import {Wallpaper} from '@/modules/desktop/wallpaper-context'

export function CmdkStory() {
	const {open, setOpen} = useCmdkOpen()

	return (
		<div className='relative z-0'>
			<Wallpaper />
			<div className='relative flex flex-col items-center gap-4 p-4'>
				<H1>CMDK</H1>
				<Search onClick={() => setOpen(true)} />
			</div>
			<InstalledAppsProvider>
				<CmdkMenu open={open} setOpen={setOpen} />
			</InstalledAppsProvider>
		</div>
	)
}
