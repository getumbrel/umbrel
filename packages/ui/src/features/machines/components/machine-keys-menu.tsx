import {Keyboard} from 'lucide-react'
import {useRef} from 'react'

import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {pressConsoleKey, type ConsoleKey} from '@/features/machines/console-keys'
import type {Machine} from '@/features/machines/types'
import {t} from '@/utils/i18n'

// Sends the machine the keys this computer keeps for itself. The keyboard
// reaches every other key on its own.
export function MachineKeysMenu({
	machine,
	buttonClassName,
	iconClassName,
	side,
}: {
	machine: Machine
	buttonClassName: string
	iconClassName: string
	// Where the tooltip and the menu open, clear of the buttons beside this one
	side: 'bottom' | 'left'
}) {
	// Pressed once the menu has closed and let go of the focus, so the console
	// can take it and hear the rest of a shortcut. With no console to take it,
	// the focus goes back to the button as usual.
	const chosenKey = useRef<ConsoleKey>(undefined)
	const keys: Array<[ConsoleKey, string]> = [
		['super', machine.osId.startsWith('windows') ? t('machines.keys-windows') : t('machines.keys-super')],
		['ctrl-alt-delete', t('machines.keys-ctrl-alt-delete')],
		['alt-tab', t('machines.keys-alt-tab')],
	]

	return (
		<DropdownMenu>
			<DarkTooltip label={t('machines.send-keys')} side={side}>
				<DropdownMenuTrigger asChild>
					<button
						className={buttonClassName}
						disabled={machine.state !== 'running'}
						aria-label={t('machines.send-keys')}
					>
						<Keyboard className={iconClassName} />
					</button>
				</DropdownMenuTrigger>
			</DarkTooltip>
			{/* p-1: match the homescreen context menu's tight padding */}
			<DropdownMenuContent
				side={side}
				align='start'
				className='p-1'
				onCloseAutoFocus={(event) => {
					const key = chosenKey.current
					if (!key) return
					chosenKey.current = undefined
					if (pressConsoleKey(machine.id, key)) event.preventDefault()
				}}
			>
				{keys.map(([key, label]) => (
					<DropdownMenuItem key={key} onSelect={() => (chosenKey.current = key)}>
						{label}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
