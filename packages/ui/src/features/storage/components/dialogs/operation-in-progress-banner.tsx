import {useTranslation} from 'react-i18next'
import {TbClock} from 'react-icons/tb'

// Banner shown in storage dialogs when a RAID operation is in progress.
// ZFS only allows one operation (expansion, rebuild, replace) at a time, so we
// inform the user and disable actions that would start a new operation.
type OperationInProgressBannerProps = {
	variant: 'wait' | 'shutdown-safe'
}

export function OperationInProgressBanner({variant}: OperationInProgressBannerProps) {
	const {t} = useTranslation()
	return (
		<div className='flex items-start gap-3 rounded-12 bg-[#F5A623]/10 p-3'>
			<TbClock className='mt-0.5 size-5 shrink-0 text-[#F5A623]' />
			<div className='flex flex-col gap-1'>
				{/* - 'wait' variant: disables the action button. User must wait for operation to complete. */}
				<span className='text-13 font-semibold text-[#F5A623]'>
					{variant === 'wait'
						? t('storage-manager.operation-in-progress.wait-title')
						: t('storage-manager.operation-in-progress.shutdown-title')}
				</span>
				{/* - 'shutdown-safe' variant: shutdown button stays enabled because ZFS operations resume after restart, but we still provide a warning. */}
				<span className='text-12 text-white/60'>
					{variant === 'wait'
						? t('storage-manager.operation-in-progress.wait-description')
						: t('storage-manager.operation-in-progress.shutdown-description')}
				</span>
			</div>
		</div>
	)
}
