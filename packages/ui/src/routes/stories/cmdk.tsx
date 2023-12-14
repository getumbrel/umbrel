import {CmdkMenu, useCmdkOpen} from '@/components/cmdk'
import {UserAppsProvider} from '@/hooks/use-user-apps'
import {H1} from '@/layouts/stories'
import {Search} from '@/modules/desktop/desktop-misc'
import {Wallpaper} from '@/modules/desktop/wallpaper-context'

export default function CmdkStory() {
	const {open, setOpen} = useCmdkOpen()

	return (
		<div className='relative z-0'>
			<Wallpaper />
			<div className='relative flex flex-col items-center gap-4 p-4'>
				<H1>CMDK</H1>
				<Search onClick={() => setOpen(true)} />
			</div>
			<UserAppsProvider>
				<CmdkMenu open={open} setOpen={setOpen} />
			</UserAppsProvider>
		</div>
	)
}
