import {useTranslation} from 'react-i18next'

import {AppIcon} from '@/components/app-icon'
import {ScrollArea} from '@/components/ui/scroll-area'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useAnimatedNumber} from '@/features/files/hooks/use-animated-number'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {ProgressRing, ProgressRingBadge} from '@/modules/floating-island/progress-ring'
import {useApps} from '@/providers/apps'
import type {OperationsInProgress} from '@/providers/global-files'
import {formatNumberI18n} from '@/utils/number'
import {secondsToEta} from '@/utils/seconds-to-eta'

export function ExpandedContent({
	operations,
	progress,
	count,
	speed,
	isPreparing,
}: {
	operations: OperationsInProgress
	progress: number
	count: number
	speed: number
	isPreparing: boolean
}) {
	const {t, i18n} = useTranslation()
	const {userAppsKeyed} = useApps()

	// Sort operations so that items with higher progress appear first
	// A lone operation gets the full ring treatment; several show the list
	if (operations.length === 1) {
		return <SingleOperation operation={operations[0]} speed={speed} isPreparing={isPreparing} />
	}

	const operationsSorted = [...operations].sort((a, b) => {
		// Treat missing values as 0
		return (b.percent ?? 0) - (a.percent ?? 0)
	})

	return (
		<div className='flex h-full w-full flex-col overflow-hidden py-5'>
			<div className='mb-4 flex items-center justify-between px-5'>
				<span className='text-xs text-white/60'>
					{t('files-listing.item-count', {
						formattedCount: formatNumberI18n({n: count, showDecimals: false, locale: i18n.language}),
						count,
					})}{' '}
					&bull; {isPreparing ? t('files-operations-island.preparing') : `${progress}%`}
				</span>
				{!isPreparing && <span className='text-xs text-white/60'>{formatFilesystemSize(speed)}/s</span>}
			</div>

			<ScrollArea className='flex-1 px-5 pb-2'>
				<div className='space-y-3'>
					{operationsSorted.map((operation) => {
						const parts = operation.destinationPath.split('/')
						const destinationFolderName = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
						const app = operation.appId ? userAppsKeyed?.[operation.appId] : undefined
						// Moves back to internal storage report their /Apps virtual path
						// (e.g. /Apps/jellyfin/data), which is meaningless to show
						const appDestination = operation.destinationPath.startsWith('/Apps/')
							? t('files-operations-island.internal-storage')
							: operation.destinationPath

						const from = formatItemName({name: operation.file.name, maxLength: 12})
						const to = formatItemName({name: destinationFolderName, maxLength: 12})
						let label: string
						if (operation.type === 'copy') {
							label = operation.file.path.startsWith('/Backups/')
								? t('files-operations-island.restoring', {from, to})
								: t('files-operations-island.copying', {from, to})
						} else {
							label = app
								? t('files-operations-island.moving-app', {app: app.name, to: appDestination})
								: t('files-operations-island.moving', {from, to})
						}

						return (
							<div key={operation.id} className='flex items-center gap-2'>
								<div className='flex-shrink-0'>
									{app ? (
										<AppIcon src={app.icon} size={28} className='rounded-6' />
									) : (
										<FileItemIcon item={operation.file} className='h-7 w-7' />
									)}
								</div>
								<div className='min-w-0 flex-1'>
									<div className='mb-1 flex items-center justify-between gap-2'>
										<span className='min-w-0 flex-1 truncate text-xs text-white/90' title={label}>
											{label}
										</span>
										<span className='flex-shrink-0 text-right text-xs text-white/60'>
											{secondsToEta(operation.secondsRemaining)}
										</span>
									</div>
									<div className='relative h-1 overflow-hidden rounded-full bg-white/20'>
										<div
											className='transition-w absolute top-0 left-0 h-full rounded-full bg-brand duration-300'
											style={{width: `${operation.percent}%`}}
										/>
									</div>
								</div>
							</div>
						)
					})}
				</div>
			</ScrollArea>
		</div>
	)
}

function SingleOperation({
	operation,
	speed,
	isPreparing,
}: {
	operation: OperationsInProgress[number]
	speed: number
	isPreparing: boolean
}) {
	const {t} = useTranslation()
	const {userAppsKeyed} = useApps()
	const app = operation.appId ? userAppsKeyed?.[operation.appId] : undefined
	const animatedPercent = useAnimatedNumber(isPreparing ? undefined : operation.percent)

	const parts = operation.destinationPath.split('/')
	const destinationFolderName = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
	// App moves land in a managed folder under the chosen location, so the
	// location is the parent; moves back home report the /Apps virtual path
	const destination =
		app && operation.destinationPath.startsWith('/Apps/')
			? t('files-operations-island.internal-storage')
			: destinationFolderName
	const isRestore = operation.type === 'copy' && operation.file.path.startsWith('/Backups/')
	const title = app
		? t('files-operations-island.single-moving-app', {app: app.name})
		: operation.type === 'copy'
			? isRestore
				? t('files-operations-island.single-restoring', {name: operation.file.name})
				: t('files-operations-island.single-copying', {name: operation.file.name})
			: t('files-operations-island.single-moving', {name: operation.file.name})
	const eta = operation.secondsRemaining ? secondsToEta(operation.secondsRemaining) : undefined

	return (
		<div className='flex size-full items-center justify-between overflow-hidden px-8 py-6'>
			{/* Left side */}
			<div className='flex min-w-0 flex-col gap-1'>
				<div className='truncate text-sm tracking-tight text-white/90'>{title}</div>
				<div className='truncate text-xs font-normal text-white/50'>
					{t('files-operations-island.single-to', {to: destination})}
				</div>
				<div className='mt-2 flex items-baseline gap-1'>
					{animatedPercent === undefined ? (
						<div className='text-2xl font-light tracking-tight text-white'>
							{t('files-operations-island.preparing')}
						</div>
					) : (
						<>
							<div className='text-5xl font-light tracking-tight text-white'>{animatedPercent.toFixed(0)}</div>
							<div className='font-medium text-white/40'>%</div>
						</>
					)}
				</div>
				{!isPreparing && (
					<div className='truncate text-xs text-white/40'>
						{formatFilesystemSize(speed)}/s
						{eta && ` · ${t('files-operations-island.time-remaining', {time: eta})}`}
					</div>
				)}
			</div>

			<ProgressRing percent={animatedPercent} transition={false}>
				<ProgressRingBadge>
					{app ? (
						<AppIcon src={app.icon} size={40} className='rounded-10' />
					) : (
						<FileItemIcon item={operation.file} className='size-10' />
					)}
				</ProgressRingBadge>
			</ProgressRing>
		</div>
	)
}
