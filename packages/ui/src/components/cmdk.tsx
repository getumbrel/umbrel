import * as DialogPrimitive from '@radix-ui/react-dialog'
import {useEffect, useState} from 'react'
import {RiCloseCircleFill} from 'react-icons/ri'
import {useNavigate} from 'react-router-dom'

import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/shadcn-components/ui/command'
import {Separator} from '@/shadcn-components/ui/separator'

export function CmdkMenu() {
	const navigate = useNavigate()
	const {open, setOpen} = useCmdkOpen()

	return (
		<CommandDialog open={open} onOpenChange={setOpen}>
			<div className='flex items-center justify-between'>
				<CommandInput placeholder='Search for apps, settings or actions' />
				<CommandCloseButton />
			</div>
			<Separator />
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

const CommandCloseButton = () => (
	<DialogPrimitive.Close className='rounded-full opacity-30 outline-none ring-white/60 transition-opacity hover:opacity-40 focus-visible:opacity-40 focus-visible:ring-2'>
		<RiCloseCircleFill className='h-5 w-5' />
		<span className='sr-only'>Close</span>
	</DialogPrimitive.Close>
)

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
