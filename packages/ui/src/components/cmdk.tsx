import {Command} from 'cmdk'
import {useEffect, useState} from 'react'

export function CmdkMenu() {
	const [open, setOpen] = useState(false)

	// Toggle the menu when ⌘K is pressed
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

	return (
		<Command.Dialog open={open} onOpenChange={setOpen}>
			<Command.Input />

			<Command.List>
				{/* {loading && <Command.Loading>Hang on…</Command.Loading>} */}

				<Command.Empty>No results found.</Command.Empty>

				<Command.Group heading='Fruits'>
					<Command.Item>Apple</Command.Item>
					<Command.Item>Orange</Command.Item>
					<Command.Separator />
					<Command.Item>Pear</Command.Item>
					<Command.Item>Blueberry</Command.Item>
				</Command.Group>

				<Command.Item>Fish</Command.Item>
			</Command.List>
		</Command.Dialog>
	)
}
