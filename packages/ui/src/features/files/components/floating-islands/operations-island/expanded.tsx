import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {useGlobalFiles} from '@/providers/global-files'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {t} from '@/utils/i18n'
import {formatNumberI18n} from '@/utils/number'
import {secondsToEta} from '@/utils/seconds-to-eta'

export function ExpandedContent({progress, count, speed}: {progress: number; count: number; speed: number}) {
	const {operations} = useGlobalFiles()

	// Sort operations so that items with higher progress appear first
	const operationsSorted = [...operations].sort((a, b) => {
		// Treat missing values as 0
		return (b.percent ?? 0) - (a.percent ?? 0)
	})

	return (
		<div className='flex h-full w-full flex-col overflow-hidden py-5'>
			<div className='mb-4 flex items-center justify-between px-5'>
				<span className='text-xs text-white/60'>
					{t('files-listing.item-count', {formattedCount: formatNumberI18n({n: count, showDecimals: false}), count})}{' '}
					&bull; {progress}%
				</span>
				<span className='text-xs text-white/60'>{formatFilesystemSize(speed)}/s</span>
			</div>

			<ScrollArea className='flex-1 px-5 pb-2'>
				<div className='space-y-3'>
					{operationsSorted.map((operation) => {
						const parts = operation.destinationPath.split('/')
						const destinationFolderName = parts.length >= 2 ? parts[parts.length - 2] : parts[0]

						return (
							<div
								key={`${operation.file.path}-${operation.destinationPath}-${operation.type}`}
								className='flex items-center gap-2'
							>
								<div className='flex-shrink-0'>
									<FileItemIcon item={operation.file} className='h-7 w-7' />
								</div>
								<div className='min-w-0 flex-1'>
									<div className='mb-1 flex items-center justify-between gap-2'>
										{operation.type === 'copy' && (
											<span className='block max-w-[16rem] whitespace-nowrap text-xs text-white/90'>
												{operation.file.path.startsWith('/Backups/') ? (
													<span className='text-white/60'>
														{t('files-operations-island.restoring', {
															from: formatItemName({name: operation.file.name, maxLength: 12}),
															to: formatItemName({name: destinationFolderName, maxLength: 12}),
														})}
													</span>
												) : (
													<span className='text-white/60'>
														{t('files-operations-island.copying', {
															from: formatItemName({name: operation.file.name, maxLength: 12}),
															to: formatItemName({name: destinationFolderName, maxLength: 12}),
														})}
													</span>
												)}
											</span>
										)}
										{operation.type === 'move' && (
											<span className='block max-w-[16rem] whitespace-nowrap text-xs text-white/90'>
												{t('files-operations-island.moving', {
													from: formatItemName({name: operation.file.name, maxLength: 12}),
													to: formatItemName({name: destinationFolderName, maxLength: 12}),
												})}
											</span>
										)}
										<span className='flex-shrink-0 text-right text-xs text-white/60'>
											{secondsToEta(operation.secondsRemaining)}
										</span>
									</div>
									<div className='relative h-1 overflow-hidden rounded-full bg-white/20'>
										<div
											className='transition-w absolute left-0 top-0 h-full rounded-full bg-brand duration-300'
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
