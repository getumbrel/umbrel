import {useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/shadcn-components/ui/command'

export function CmdkMenu() {
	const navigate = useNavigate()
	const {open, setOpen} = useCmdkOpen()

	return (
		<CommandDialog open={open} onOpenChange={setOpen}>
			<CommandInput placeholder='Search for apps, settings or actions' />
			<CommandList>
				<CommandEmpty>No results found.</CommandEmpty>
				<CommandGroup>
					<CommandItem
						onSelect={() => {
							navigate('/settings/restart')
							setOpen(false)
						}}
					>
						Restart Umbrel
					</CommandItem>
					<CommandItem
						onSelect={() => {
							navigate('/app-store?dialog=updates')
							setOpen(false)
						}}
					>
						Update all apps
					</CommandItem>
					<CommandItem
						onSelect={() => {
							navigate('/settings')
							setOpen(false)
						}}
					>
						Change wallpaper
					</CommandItem>
					<CommandItem
						onSelect={() => {
							navigate('/edit-widgets')
							setOpen(false)
						}}
					>
						Add widgets
					</CommandItem>
				</CommandGroup>
			</CommandList>
		</CommandDialog>
	)
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
