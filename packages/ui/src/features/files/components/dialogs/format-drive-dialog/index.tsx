import {AlertOctagon} from 'lucide-react'
import {useEffect, useState} from 'react'
import {RiErrorWarningFill} from 'react-icons/ri'

import {ErrorAlert} from '@/components/ui/alert'
import externalStorageIcon from '@/features/files/assets/external-storage-icon.png'
import {useExternalStorage} from '@/features/files/hooks/use-external-storage'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import {Input} from '@/shadcn-components/ui/input'
import {Label} from '@/shadcn-components/ui/label'
import {cn} from '@/shadcn-lib/utils'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

function FilesystemCard({
	id,
	name,
	description,
	selected,
	onClick,
	disabled,
}: {
	id: string
	name: string
	description: string
	selected: boolean
	onClick: () => void
	disabled?: boolean
}) {
	return (
		<button
			type='button'
			id={id}
			onClick={onClick}
			disabled={disabled}
			tabIndex={-1}
			className={cn(
				'flex min-h-[80px] cursor-pointer flex-col items-start justify-between rounded-xl border p-3 text-left transition-colors duration-100 sm:min-h-[120px] sm:p-4',
				selected ? 'border-brand bg-brand/15' : 'border-white/10 bg-white/5 hover:bg-white/10',
				disabled && 'cursor-not-allowed opacity-50',
			)}
		>
			<div className='flex items-baseline gap-1'>
				<span className='text-16 font-medium text-white/90'>{name}</span>
				<span className='text-12 lowercase text-white/50'>{t('files-format.filesystem')}</span>
			</div>
			<span className='text-12 text-white/70'>{description}</span>
		</button>
	)
}

export default function FormatDriveDialog() {
	const dialogProps = useDialogOpenProps('files-format-drive')
	const {disks, formatExternalStorageDevice, isFormatting} = useExternalStorage()
	const [filesystem, setFilesystem] = useState<'ext4' | 'exfat'>('ext4')
	const [label, setLabel] = useState('')

	const resetForm = () => {
		setFilesystem('ext4')
		setLabel('')
	}

	// Reset form when dialog closes
	useEffect(() => {
		if (!dialogProps.open) {
			resetForm()
		}
	}, [dialogProps.open])

	// Find the drive that needs formatting from query params
	// The dialog is opened via ?dialog=files-format-drive&deviceId=sdc
	const urlParams = new URLSearchParams(window.location.search)
	const deviceId = urlParams.get('deviceId')
	const drive = disks?.find((d) => d.id === deviceId)

	if (!drive || drive.isFormatting) return null

	const requiresFormat = !drive.isMounted

	const MAX_LABEL_LENGTH = 11

	const handleFormat = async () => {
		await formatExternalStorageDevice({
			deviceId: drive.id,
			filesystem,
			label: label || drive.name.slice(0, MAX_LABEL_LENGTH),
		})
		dialogProps.onOpenChange(false)
		resetForm()
	}

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent className='max-sm:px-4'>
				<AlertDialogHeader className='max-sm:py-0'>
					<div className='flex flex-row items-center gap-5 sm:flex-col sm:items-start sm:gap-4'>
						<div className='relative shrink-0'>
							<img
								src={externalStorageIcon}
								alt={t('external-drive')}
								className='size-14 opacity-90'
								draggable={false}
							/>
							{requiresFormat && (
								<div className='absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full bg-[#FF9500]'>
									<RiErrorWarningFill className='size-6 text-black' />
								</div>
							)}
						</div>
						<div className='flex min-w-0 flex-1 flex-col gap-0.5 sm:gap-2'>
							<AlertDialogTitle className='text-left'>
								{requiresFormat ? t('files-format.title-requires-format') : t('files-format.title')}
							</AlertDialogTitle>
							<span className='text-left text-sm text-white/70'>
								{requiresFormat
									? t('files-format.description-unreadable', {driveName: drive.name})
									: t('files-format.description', {driveName: drive.name})}
							</span>
						</div>
					</div>
				</AlertDialogHeader>
				<AlertDialogDescription className='flex flex-col gap-5 text-left'>
					{/* Filesystem selection */}
					<div className='flex flex-col gap-2'>
						<Label className='text-left text-13 text-white'>{t('files-format.filesystem-label')}</Label>
						<div className='grid gap-4 max-sm:grid-cols-1 sm:grid-cols-2'>
							<FilesystemCard
								id='ext4'
								name='ext4'
								description={t('files-format.ext4-description')}
								selected={filesystem === 'ext4'}
								onClick={() => {
									setFilesystem('ext4')
									if (label.length > MAX_LABEL_LENGTH) {
										setLabel(label.slice(0, MAX_LABEL_LENGTH))
									}
								}}
								disabled={isFormatting}
							/>
							<FilesystemCard
								id='exfat'
								name='exFAT'
								description={t('files-format.exfat-description')}
								selected={filesystem === 'exfat'}
								onClick={() => {
									setFilesystem('exfat')
									if (label.length > MAX_LABEL_LENGTH) {
										setLabel(label.slice(0, MAX_LABEL_LENGTH))
									}
								}}
								disabled={isFormatting}
							/>
						</div>
					</div>

					{/* Drive label input */}
					<div className='flex flex-col gap-2'>
						<Label htmlFor='label' className='text-left text-13 text-white'>
							{t('files-format.drive-label')}
						</Label>
						<Input
							id='label'
							value={label}
							onChange={(e) => {
								const newValue = e.target.value
								if (newValue.length <= MAX_LABEL_LENGTH) {
									setLabel(newValue)
								}
							}}
							placeholder={drive.name.slice(0, MAX_LABEL_LENGTH)}
							className='w-full bg-white/5'
							disabled={isFormatting}
							autoFocus
							maxLength={MAX_LABEL_LENGTH}
						/>
					</div>
					<ErrorAlert
						icon={AlertOctagon}
						description={t('files-format.description', {driveName: drive.name})}
						className='text-left sm:my-1'
					/>
				</AlertDialogDescription>

				<AlertDialogFooter className='md:justify-start'>
					<AlertDialogAction
						variant='destructive'
						className='px-6'
						onClick={handleFormat}
						disabled={isFormatting}
						hideEnterIcon
					>
						{isFormatting ? t('files-format.formatting') : t('files-format.confirm')}
					</AlertDialogAction>
					<AlertDialogCancel disabled={isFormatting}>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
