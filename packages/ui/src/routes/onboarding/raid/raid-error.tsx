import {useTranslation} from 'react-i18next'

import {StorageHeader, StoragePage} from '@/features/storage/components/storage-page'
import {primaryButtonProps, secondaryButtonClasss} from '@/layouts/bare/shared'
import {useGlobalSystemState} from '@/providers/global-system-state'

type RaidErrorProps = {
	title: string
	instructions: string
	detail?: string
	retryLabel?: string
	onRetry?: () => void
	retrying?: boolean
	secondaryAction?: {label: string; onClick: () => void}
	image?: {src: string; alt: string}
}

export function RaidError({
	title,
	instructions,
	detail,
	image,
	onRetry,
	retrying,
	retryLabel,
	secondaryAction,
}: RaidErrorProps) {
	const {t} = useTranslation()
	const {shutdown, isPowerActionPending} = useGlobalSystemState()
	return (
		<StoragePage
			footer={
				<div className='flex flex-wrap gap-3'>
					{onRetry && (
						<button {...primaryButtonProps} onClick={onRetry} disabled={retrying || isPowerActionPending}>
							{retryLabel ?? t('storage-status.check-again')}
						</button>
					)}
					{secondaryAction && (
						<button className={secondaryButtonClasss} onClick={secondaryAction.onClick} disabled={isPowerActionPending}>
							{secondaryAction.label}
						</button>
					)}
					<button className={secondaryButtonClasss} onClick={() => shutdown()} disabled={isPowerActionPending}>
						{t('shut-down')}
					</button>
				</div>
			}
		>
			<StorageHeader title={title} subTitle={instructions} />
			{detail && (
				<details className='text-12 text-white/40'>
					<summary className='cursor-pointer'>{t('storage-status.details')}</summary>
					<p className='mt-2 break-words'>{detail}</p>
				</details>
			)}
			{image && (
				<img
					src={image.src}
					alt={image.alt}
					draggable={false}
					className='mt-auto hidden w-full max-w-[800px] self-center object-contain md:block'
				/>
			)}
		</StoragePage>
	)
}
