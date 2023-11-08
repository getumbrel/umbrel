import {useCommandState} from 'cmdk'
import {ComponentPropsWithoutRef, useEffect, useRef, useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {systemAppsKeyed, useInstalledApps} from '@/hooks/use-installed-apps'
import {useQueryParams} from '@/hooks/use-query-params'
import {CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList} from '@/shadcn-components/ui/command'
import {Separator} from '@/shadcn-components/ui/separator'
import {trpcClient, trpcReact} from '@/trpc/trpc'
import {trackAppOpen} from '@/utils/track-app-open'

import {AppIcon} from './app-icon'

export function CmdkMenu() {
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()
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
				onKeyUp={() => scrollRef.current?.scrollTo(0, 0)}
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
					<SubItem value={app.name} icon={app.icon} key={app.id} onSelect={() => trackAppOpen(app.id)}>
						{app.name}
					</SubItem>
				))}
				<SubItem
					value={systemAppsKeyed['home'].name}
					icon={systemAppsKeyed['home'].icon}
					onSelect={() => {
						navigate(systemAppsKeyed['home'].systemAppTo)
						setOpen(false)
					}}
				>
					{systemAppsKeyed['home'].name}
				</SubItem>
				<SubItem
					value={systemAppsKeyed['app-store'].name}
					icon={systemAppsKeyed['app-store'].icon}
					onSelect={() => {
						navigate(systemAppsKeyed['app-store'].systemAppTo)
						setOpen(false)
					}}
				>
					{systemAppsKeyed['app-store'].name}
				</SubItem>
				<SubItem
					value={systemAppsKeyed['settings'].name}
					icon={systemAppsKeyed['settings'].icon}
					onSelect={() => {
						navigate(systemAppsKeyed['settings'].systemAppTo)
						setOpen(false)
					}}
				>
					{systemAppsKeyed['settings'].name}
				</SubItem>
				<SubItem
					value={systemAppsKeyed['exit'].name}
					icon={systemAppsKeyed['exit'].icon}
					onSelect={() => {
						navigate({search: addLinkSearchParams({dialog: 'logout'})})
						setOpen(false)
					}}
				>
					{systemAppsKeyed['exit'].name}
				</SubItem>
			</CommandList>
		</CommandDialog>
	)
}

function FrequentApps() {
	const [lastOpenedApps, setLastOpenedApps] = useState<string[]>([])
	useEffect(() => {
		trpcClient.user.get.query().then((data) => setLastOpenedApps(data.lastOpenedApps ?? []))
	}, [])

	const search = useCommandState((state) => state.search)

	// If there's a search query, don't show frequent apps
	if (search) return null
	if (!lastOpenedApps) return null

	return (
		<>
			<div>
				<h3 className='mb-5 text-15 font-semibold leading-tight -tracking-2'>Frequent apps</h3>
				<div className='umbrel-hide-scrollbar umbrel-fade-scroller-x overflow-x-auto whitespace-nowrap'>
					{/* <JSONTree data={appsByFrequency(lastOpenedApps, 6)} /> */}
					{appsByFrequency(lastOpenedApps, 6).map((appId) => (
						<FrequentApp key={appId} appId={appId} />
					))}
				</div>
			</div>
			<Separator />
		</>
	)
}

function appsByFrequency(lastOpenedApps: string[], count: number) {
	const openCounts = new Map<string, number>()

	lastOpenedApps.map((appId) => {
		if (!openCounts.has(appId)) {
			openCounts.set(appId, 1)
		} else {
			openCounts.set(appId, openCounts.get(appId)! + 1)
		}
	})

	const sortedAppIds = [...openCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, count)
		.map((a) => a[0])

	return sortedAppIds
}

function FrequentApp({appId}: {appId: string}) {
	const {installedAppsKeyed, isLoading} = useInstalledApps()
	if (isLoading) return null

	return (
		<button
			className='inline-flex w-[100px] flex-col items-center gap-2 overflow-hidden rounded-8 border border-transparent p-2 outline-none transition-all hover:border-white/10 hover:bg-white/4 focus-visible:border-white/10 focus-visible:bg-white/4 active:border-white/20'
			onClick={() => trackAppOpen(appId)}
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
