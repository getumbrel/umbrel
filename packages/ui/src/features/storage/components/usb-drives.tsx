import {useId} from 'react'
import {useTranslation} from 'react-i18next'
import {Link} from 'react-router-dom'

import externalStorageIcon from '@/features/files/assets/external-storage-icon.png'
import {useExternalStorageDevices} from '@/features/files/hooks/use-external-storage-devices'

import {formatStorageSize} from '../utils'

export function UsbDrives() {
	const {t} = useTranslation()
	const titleId = useId()
	const devicesQ = useExternalStorageDevices()
	const drives = devicesQ.data ?? []
	// Keep the initial load quiet, and omit the section when no USB drives exist.
	if (drives.length === 0 && !devicesQ.isError) return null

	return (
		<section aria-labelledby={titleId} className='flex flex-col gap-2.5'>
			<div className='flex flex-col gap-1'>
				<div className='flex items-center justify-between gap-3'>
					<h2 id={titleId} className='text-13 font-semibold text-white/50'>
						{t('storage-manager.usb-drives')}
					</h2>
					<Link
						to='/files/External'
						className='flex shrink-0 items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.06] px-3 py-1 text-12 font-medium text-white/80 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-hidden'
					>
						<img
							src='/assets/dock/dock-files.webp'
							alt=''
							draggable={false}
							className='size-4 shrink-0 rounded-[4px]'
						/>
						<span>{t('storage-manager.usb-drives.open-files', {app: t('files')})}</span>
					</Link>
				</div>
				<p className='text-13 leading-relaxed text-white/50'>{t('storage-manager.usb-drives.description')}</p>
			</div>
			{devicesQ.isError && (
				<div role='status' className='flex flex-wrap items-center gap-x-3 gap-y-1 text-13 text-white/50'>
					<p>{t('storage-manager.usb-drives.unavailable')}</p>
					<button
						type='button'
						disabled={devicesQ.isFetching}
						onClick={() => void devicesQ.refetch()}
						className='text-white/80 underline underline-offset-2 hover:text-white disabled:opacity-50'
					>
						{t('try-again')}
					</button>
				</div>
			)}
			{drives.map((drive) => {
				const mounted = drive.partitions.filter((partition) => partition.mountpoints.length > 0)
				// Match the labels people see in Files. For multiple volumes, use the
				// physical drive name and list the volume labels underneath it.
				const name =
					mounted.length === 1
						? mounted[0].label || drive.name || t('external-drive')
						: drive.name || t('external-drive')
				const detail =
					mounted.length > 1
						? mounted.map((partition) => partition.label || partition.mountpoints[0].split('/').at(-1)).join(', ')
						: name !== drive.name
							? drive.name
							: ''
				return (
					<div key={drive.id} className='flex w-full items-center gap-4 rounded-12 bg-white/5 p-4'>
						<img src={externalStorageIcon} alt='' draggable={false} className='size-12 shrink-0 object-contain' />
						<div className='min-w-0 flex-1'>
							<div className='truncate text-[15px] font-medium text-white' title={name}>
								{name}
							</div>
							<div className='truncate text-13 text-white/50' title={detail}>
								{formatStorageSize(drive.size)}
								{detail && ` · ${detail}`}
							</div>
						</div>
					</div>
				)
			})}
		</section>
	)
}
