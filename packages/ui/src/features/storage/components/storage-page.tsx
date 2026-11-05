import {useTranslation} from 'react-i18next'
import {TbAlertTriangle, TbInfoCircle, TbX} from 'react-icons/tb'

import {primaryButtonProps} from '@/layouts/bare/shared'
import {cn} from '@/lib/utils'

// Content sits on the onboarding material. The same primitives also work inside
// Storage Manager; they do not own routing, queries, or operation state.
export function StoragePage({
	children,
	footer,
	pinnedFooter = false,
}: {
	children: React.ReactNode
	footer?: React.ReactNode
	pinnedFooter?: boolean
}) {
	return (
		<div
			className={cn(
				'flex w-full max-w-[1000px] min-w-0 flex-1 flex-col self-center px-4 py-6 md:px-6 md:pt-10 md:pb-4',
				pinnedFooter && 'min-h-0 overflow-hidden',
			)}
		>
			{/* Selection steps keep their actions visible while the drive list scrolls. */}
			<div
				className={cn(
					'flex flex-1 flex-col gap-5',
					pinnedFooter && 'min-h-0 overflow-y-auto overscroll-contain *:shrink-0',
				)}
			>
				{children}
			</div>
			{footer && (
				<div className='mt-6 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5'>
					{footer}
				</div>
			)}
		</div>
	)
}

export function StorageHeader({
	title,
	titleExtra,
	subTitle,
	className,
}: {
	title: string
	titleExtra?: React.ReactNode
	subTitle?: React.ReactNode
	className?: string
}) {
	return (
		<div className={cn('flex flex-col gap-1 md:gap-2', className)}>
			<h1
				className='text-[20px] font-bold text-white/85 md:text-[24px]'
				style={{textShadow: '0 0 8px rgba(255, 255, 255, 0.2), 0 0 16px rgba(255, 255, 255, 0.15)'}}
			>
				{title}
				{titleExtra && <> {titleExtra}</>}
			</h1>
			{subTitle && <p className='max-w-[640px] text-[14px] leading-relaxed text-white/50 md:text-[16px]'>{subTitle}</p>}
		</div>
	)
}

export function StorageNotice({
	children,
	tone = 'warning',
	onDismiss,
}: {
	children: React.ReactNode
	tone?: 'warning' | 'danger' | 'neutral'
	onDismiss?: () => void
}) {
	const {t} = useTranslation()
	const Icon = tone === 'neutral' ? TbInfoCircle : TbAlertTriangle
	return (
		<div
			className={cn(
				'flex items-start gap-2.5 rounded-xl p-3.5 text-13 leading-relaxed',
				tone === 'danger'
					? 'bg-destructive2/10 text-destructive2'
					: tone === 'warning'
						? 'bg-[#F5A623]/10 text-[#F5A623]'
						: 'bg-white/5 text-white/60',
			)}
		>
			<Icon className='mt-0.5 size-4 shrink-0' />
			<div className='min-w-0 flex-1'>{children}</div>
			{onDismiss && (
				<button
					type='button'
					aria-label={t('close')}
					onClick={onDismiss}
					className='shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100'
				>
					<TbX className='size-4' />
				</button>
			)}
		</div>
	)
}

export function StorageReadError({
	message,
	onRetry,
	retrying,
	detail,
}: {
	message?: string
	onRetry?: () => void
	retrying?: boolean
	detail?: string
}) {
	const {t} = useTranslation()
	return (
		<div className='flex flex-col items-start gap-4'>
			<StorageNotice>{message ?? t('storage-status.check-failed')}</StorageNotice>
			{detail && (
				<details className='max-w-full text-12 text-white/40'>
					<summary className='cursor-pointer'>{t('storage-status.details')}</summary>
					<p className='mt-2 break-words'>{detail}</p>
				</details>
			)}
			{onRetry && (
				<button {...primaryButtonProps} onClick={onRetry} disabled={retrying}>
					{t('storage-status.check-again')}
				</button>
			)}
		</div>
	)
}
