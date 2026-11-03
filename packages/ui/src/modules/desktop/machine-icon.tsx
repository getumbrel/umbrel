import {motion} from 'motion/react'
import {useNavigate} from 'react-router-dom'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'
import {contextMenuClasses} from '@/components/ui/shared/menu'
import {MachineAppIcon} from '@/features/machines/components/machine-app-icon'
import {machinePath} from '@/features/machines/constants'
import {useMachineActions} from '@/features/machines/hooks/use-machine-actions'
import type {Machine} from '@/features/machines/types'
import {isMachineStartable} from '@/features/machines/utils'
import {t} from '@/utils/i18n'

// Desktop icon for a machine pinned to the homescreen. Looks like an app icon
// with a small Machines-app thumbnail in the corner marking its origin app
// (see Figma "Pinning VMs to Homepage").
export function MachineIcon({machine}: {machine: Machine}) {
	const navigate = useNavigate()
	const {start, stop, forceStop, retryInstall, setPinned} = useMachineActions()

	return (
		<ContextMenu>
			<ContextMenuTrigger className='group'>
				<motion.button
					onClick={() => navigate(machinePath(machine.id))}
					className='group flex h-[var(--app-h)] w-[var(--app-w)] flex-col items-center gap-2.5 py-[var(--app-pad)] focus:outline-hidden'
					layout
					initial={{opacity: 1, scale: 0.8}}
					animate={{opacity: 1, scale: 1}}
					exit={{opacity: 0, scale: 0.5}}
					transition={{type: 'spring', stiffness: 500, damping: 30}}
				>
					<MachineAppIcon
						osId={machine.osId}
						state={machine.state}
						className='w-[var(--app-icon)] rounded-[var(--app-icon-radius)] ring-white/25 transition-all duration-300 group-hover:scale-110 group-hover:ring-6 group-focus-visible:ring-6 group-active:scale-95 group-data-[state=open]:ring-6'
					/>
					<div className='max-w-full text-[length:var(--app-label)] leading-normal drop-shadow-desktop-label'>
						<div className='truncate contrast-more:bg-black contrast-more:px-1'>{machine.name}</div>
					</div>
				</motion.button>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={() => navigate(machinePath(machine.id))}>{t('machines.open')}</ContextMenuItem>
				{isMachineStartable(machine.state) ? (
					// An install that stopped partway can only be retried, as in the list and the machine's window
					machine.state === 'error' && machine.installPending ? (
						<ContextMenuItem onSelect={() => retryInstall({id: machine.id})}>
							{t('machines.retry-install')}
						</ContextMenuItem>
					) : (
						<ContextMenuItem onSelect={() => start({id: machine.id})}>
							{machine.state === 'error' ? t('machines.turn-on-again') : t('machines.turn-on')}
						</ContextMenuItem>
					)
				) : (
					<ContextMenuItem disabled={machine.state !== 'running'} onSelect={() => stop({id: machine.id})}>
						{t('machines.shut-down')}
					</ContextMenuItem>
				)}
				{machine.state !== 'stopped' && machine.state !== 'installing' && (
					<ContextMenuItem
						className={contextMenuClasses.item.rootDestructive}
						onSelect={() => forceStop({id: machine.id})}
					>
						{t('machines.force-shut-down')}
					</ContextMenuItem>
				)}
				<ContextMenuItem onSelect={() => setPinned({id: machine.id, pinned: false})}>
					{t('machines.unpin-from-homescreen')}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}
