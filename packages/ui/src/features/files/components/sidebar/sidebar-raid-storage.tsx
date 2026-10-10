import {FaEject} from 'react-icons/fa6'
import {RiHardDrive2Fill} from 'react-icons/ri'

import {SharedFolderBadge} from '@/features/files/assets/shared-folder-badge'
import {Droppable} from '@/features/files/components/shared/drag-and-drop'
import {useRaidMounts} from '@/features/files/hooks/use-raid-mounts'
import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

const selectedClass = tw`
  bg-linear-to-b from-white/[0.04] to-white/[0.08]
  border-white/6
  shadow-button-highlight-soft-hpx
`

export function SidebarRaidStorage() {
	const {mounts, isEjecting, ejectRaid, isPathShared, currentPath, navigateToDirectory, t} = useRaidMounts()

	if (mounts.length === 0) return null

	return (
		<div className='flex flex-col gap-0.5'>
			{mounts.map((mount) => (
				<div key={mount.device} className='flex w-full items-center gap-1.5'>
					<Droppable
						id={`sidebar-${mount.path}`}
						path={mount.path}
						onClick={() => navigateToDirectory(mount.path)}
						className={cn(
							'flex flex-1 items-center gap-1.5 rounded-lg border border-transparent from-white/[0.04] to-white/[0.08] px-2 py-1.5 text-12 hover:bg-linear-to-b',
							currentPath === mount.path ? selectedClass : 'text-white/60 hover:bg-white/10 hover:text-white',
						)}
						role='button'
					>
						<div className='relative'>
							<RiHardDrive2Fill className='h-3 w-3 flex-shrink-0' />
							{isPathShared(mount.path) && (
								<div className='absolute -top-1 -left-1 flex size-3 items-center justify-center rounded-full border border-white/15 bg-linear-to-b from-brand to-[color-mix(in_srgb,hsl(var(--color-brand))_80%,black_20%)]'>
									<SharedFolderBadge className='size-[80%]' />
								</div>
							)}
						</div>
						<span className='min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap'>{mount.name}</span>
						<span className='text-11 text-white/30'>{mount.filesystem}</span>
						{!mount.native && <span className='text-11 text-[#F5A623]'>{t('files-raid.no-ownership')}</span>}
					</Droppable>
					<button
						onClick={(e) => {
							// Never let the eject click fall through to navigating into the array
							e.stopPropagation()
							ejectRaid({device: mount.device})
						}}
						disabled={isEjecting}
						aria-label={t('files-action.eject-disk')}
						className='flex shrink-0 items-center px-1'
					>
						<FaEject className='text-white/60 hover:text-white' />
					</button>
				</div>
			))}
		</div>
	)
}
