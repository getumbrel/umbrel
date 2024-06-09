import {H1} from '@stories/components'

import {CmdkMenu, CmdkProvider, useCmdkOpen} from '@/components/cmdk'
import {Search} from '@/modules/desktop/desktop-misc'
import {AppsProvider} from '@/providers/apps'
import {Wallpaper} from '@/providers/wallpaper'

export default function CmdkStory() {
	return (
		<CmdkProvider>
			<Inner />
		</CmdkProvider>
	)
}

function Inner() {
	const {setOpen} = useCmdkOpen()

	return (
		<div className='relative z-0'>
			<Wallpaper />
			<div className='relative flex flex-col items-center gap-4 p-4'>
				<H1>CMDK</H1>
				<Search onClick={() => setOpen(true)} />
			</div>
			<AppsProvider>
				<CmdkMenu />
			</AppsProvider>
		</div>
	)
}
