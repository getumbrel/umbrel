import {useCommandState} from 'cmdk'
import {ComponentPropsWithoutRef, useEffect, useRef, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {range} from 'remeda'

import {systemAppsKeyed, useApps} from '@/hooks/use-apps'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {useQueryParams} from '@/hooks/use-query-params'
import {CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList} from '@/shadcn-components/ui/command'
import {Separator} from '@/shadcn-components/ui/separator'
import {trpcReact} from '@/trpc/trpc'

import {AppIcon} from './app-icon'

export function CmdkMenu({open, setOpen}: {open: boolean; setOpen: (open: boolean) => void}) {
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()
	const {userApps, isLoading} = useApps()
	const scrollRef = useRef<HTMLDivElement>(null)
	const userQ = trpcReact.user.get.useQuery()
	const launchApp = useLaunchApp()

	if (isLoading) return null
	if (!userApps) return null
	if (userQ.isLoading) return null

	const installedApps = userApps.filter((app) => app.state === 'ready')

	return (
		<CommandDialog open={open} onOpenChange={setOpen}>
			<CommandInput placeholder='Search for apps, settings or actions' />
			<Separator />
			<CommandList ref={scrollRef}>
				<FrequentApps />
				<CommandEmpty>No results found.</CommandEmpty>
				<CommandItem
					icon={systemAppsKeyed['settings'].icon}
					onSelect={() => {
						navigate({pathname: '/settings', search: addLinkSearchParams({dialog: 'restart'})})
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
					<SubItem
						value={app.name}
						icon={app.icon}
						key={app.id}
						onSelect={() => {
							launchApp(app.id)
							setOpen(false)
						}}
					>
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
					value={systemAppsKeyed['settings'].name}
					icon={systemAppsKeyed['settings'].icon}
					onSelect={() => {
						navigate({search: addLinkSearchParams({dialog: 'logout'})})
						setOpen(false)
					}}
				>
					{systemAppsKeyed['settings'].name}
				</SubItem>
			</CommandList>
		</CommandDialog>
	)
}

function FrequentApps() {
	const lastAppsQ = trpcReact.user.get.useQuery(undefined, {
		retry: false,
	})
	const lastApps = lastAppsQ.data?.lastOpenedApps ?? []
	const {userAppsKeyed} = useApps()

	const search = useCommandState((state) => state.search)

	// If there's a search query, don't show frequent apps
	if (search) return null
	if (!userAppsKeyed) return null
	if (!lastApps) return null
	if (lastApps.length === 0) return null

	return (
		<div className='mb-5 flex flex-col gap-5'>
			<div>
				<h3 className='mb-5 text-15 font-semibold leading-tight -tracking-2'>Frequent apps</h3>
				<div className='umbrel-hide-scrollbar umbrel-fade-scroller-x overflow-x-auto whitespace-nowrap'>
					{/* Show skeleton by default to prevent layout shift */}
					{lastAppsQ.isLoading && range(0, 3).map((i) => <FrequentApp key={i} appId={''} icon='' name='–' port={0} />)}
					{appsByFrequency(lastApps, 6).map((appId) => (
						<FrequentApp
							key={appId}
							appId={appId}
							port={userAppsKeyed[appId]?.port}
							icon={userAppsKeyed[appId]?.icon}
							name={userAppsKeyed[appId]?.name}
						/>
					))}
				</div>
			</div>

			<Separator />
		</div>
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

function FrequentApp({appId, icon, name, port}: {appId: string; icon: string; name: string; port: number}) {
	const launchApp = useLaunchApp()
	return (
		<button
			className='inline-flex w-[100px] flex-col items-center gap-2 overflow-hidden rounded-8 border border-transparent p-2 outline-none transition-all hover:border-white/10 hover:bg-white/4 focus-visible:border-white/10 focus-visible:bg-white/4 active:border-white/20'
			onClick={() => launchApp(appId)}
			onKeyDown={(e) => {
				if (e.key === 'Enter') {
					// Prevent triggering first selected cmdk item
					e.preventDefault()
					launchApp(appId)
				}
			}}
		>
			<AppIcon src={icon} size={64} className='rounded-15' />
			<div className='w-full truncate text-13 -tracking-2 text-white/75'>{name ?? appId}</div>
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
