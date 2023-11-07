import {useCommandState} from 'cmdk'
import {ComponentPropsWithoutRef, useEffect, useRef, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {toast} from 'sonner'

import {systemAppsKeyed, useInstalledApps} from '@/hooks/use-installed-apps'
import {CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList} from '@/shadcn-components/ui/command'
import {Separator} from '@/shadcn-components/ui/separator'
import {trpcReact} from '@/trpc/trpc'
import {fixmeHandler} from '@/utils/misc'

import {AppIcon} from './app-icon'

export function CmdkMenu() {
	const navigate = useNavigate()
	const {open, setOpen} = useCmdkOpen()
	const {installedApps, isLoading} = useInstalledApps()
	const scrollRef = useRef<HTMLDivElement>(null)
	const userQ = trpcReact.user.get.useQuery()

	if (isLoading) return null
	if (userQ.isLoading) return null

	return (
		<CommandDialog open={open} onOpenChange={setOpen}>
			<CommandInput
				placeholder='Search for apps, settings or actions'
				onKeyDown={() => scrollRef.current?.scrollTo(0, 0)}
			/>
			<Separator />
			<FrequentApps />
			<CommandList ref={scrollRef}>
				<CommandEmpty>No results found.</CommandEmpty>
				<CommandItem
					icon={systemAppsKeyed['settings'].icon}
					onSelect={() => {
						navigate('/settings/restart')
						setOpen(false)
					}}
				>
					Restart Umbrel
				</CommandItem>
				<CommandItem
					icon={systemAppsKeyed['app-store'].icon}
					onSelect={() => {
						navigate('/app-store?dialog=updates')
						setOpen(false)
					}}
				>
					Update all apps
				</CommandItem>
				<CommandItem
					icon={systemAppsKeyed['settings'].icon}
					onSelect={() => {
						navigate('/settings')
						setOpen(false)
					}}
				>
					Change wallpaper
				</CommandItem>
				<CommandItem
					icon={systemAppsKeyed['home'].icon}
					onSelect={() => {
						navigate('/edit-widgets')
						setOpen(false)
					}}
				>
					Add widgets
				</CommandItem>
				{installedApps.map((app) => (
					<SubItem icon={app.icon} key={app.id} onSelect={fixmeHandler}>
						{app.name}
						{/* <span className='text-white/50'>Open app</span> */}
					</SubItem>
				))}
			</CommandList>
		</CommandDialog>
	)
}

function FrequentApps() {
	const userQ = trpcReact.user.get.useQuery()
	const lastAppId = userQ.data?.lastAppId
	const search = useCommandState((state) => state.search)

	// If there's a search query, don't show frequent apps
	if (search) return null
	if (!lastAppId) return null

	return (
		<div>
			<h3 className='text-15 font-semibold -tracking-2'>Frequent apps</h3>
			<FrequentApp appId={lastAppId} />
		</div>
	)
}

function FrequentApp({appId}: {appId: string}) {
	const {installedAppsKeyed, isLoading} = useInstalledApps()
	if (isLoading) return null

	return (
		<button
			className='flex w-[100px] flex-col items-center gap-2 overflow-hidden rounded-8 border border-transparent p-2 outline-none transition-all hover:border-white/10 hover:bg-white/4 focus-visible:border-white/10 focus-visible:bg-white/4 active:border-white/20'
			onClick={() => toast(`${appId} opened`)}
		>
			<AppIcon src={installedAppsKeyed[appId].icon} size={64} className='rounded-15' />
			<div className='w-full truncate text-13 -tracking-2 text-white/75'>{installedAppsKeyed[appId].name}</div>
		</button>
	)
}

const SubItem = (props: ComponentPropsWithoutRef<typeof CommandItem>) => {
	const search = useCommandState((state) => state.search)
	if (!search) return null

	return <CommandItem {...props} />
}

export function useCmdkOpen() {
	const [open, setOpen] = useState(false)

	useEffect(() => {
		const down = (e: KeyboardEvent) => {
			if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault()
				setOpen((open) => !open)
			}
		}
		document.addEventListener('keydown', down)
		return () => document.removeEventListener('keydown', down)
	}, [])

	return {open, setOpen}
}
