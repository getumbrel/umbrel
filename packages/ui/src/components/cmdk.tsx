import {useCommandState} from 'cmdk'
import {ComponentPropsWithoutRef, useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {systemAppsKeyed, useInstalledApps} from '@/hooks/use-installed-apps'
import {CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList} from '@/shadcn-components/ui/command'
import {Separator} from '@/shadcn-components/ui/separator'
import {fixmeHandler} from '@/utils/misc'

// FIXME: searching "but" then pressing backspace to and typing "bit" gives zero results but it should at least show "Bitcoin"
export function CmdkMenu() {
	const navigate = useNavigate()
	const {open, setOpen} = useCmdkOpen()
	const {installedApps, isLoading} = useInstalledApps()

	if (isLoading) return null

	return (
		<CommandDialog open={open} onOpenChange={setOpen}>
			<CommandInput placeholder='Search for apps, settings or actions' />
			<Separator />
			<CommandList>
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
