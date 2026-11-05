import {useTranslation} from 'react-i18next'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {ScrollArea} from '@/components/ui/scroll-area'
import {CloudBreakDiagram} from '@/features/files/components/cloud-break-diagram'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {cloudSyncName, useCloudActions, type CloudAccount, type CloudSync} from '@/features/files/hooks/use-cloud'
import {cloudAccountBrand} from '@/features/files/utils/cloud'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'

// Disconnecting an account, shown the way permanent deletion shows its items:
// the folders whose downloads stop rendered as a real list, under copy that
// makes the safe part unmistakable: everything already downloaded stays and
// the folders become regular folders.
export function CloudDisconnectDialog({
	account,
	clouds,
	onOpenChange,
}: {
	account: CloudAccount | null
	clouds: CloudSync[]
	onOpenChange: (open: boolean) => void
}) {
	const {t} = useTranslation()
	const {removeAccount} = useCloudActions()

	if (!account) return null

	const needsScroll = clouds.length > 3

	const FoldersList = () => (
		<div className='flex flex-col'>
			{clouds.map((cloud, index) => (
				<div
					key={cloud.id}
					className={`flex items-center gap-2 rounded-lg p-3 ${needsScroll && index % 2 === 0 ? 'bg-white/3' : ''}`}
				>
					<FileItemIcon
						item={{
							path: cloud.destination.path,
							type: 'directory',
							name: cloudSyncName(cloud),
							operations: [],
							size: 0,
							modified: 0,
						}}
						className='h-8 w-8'
					/>
					<span className='truncate text-12 text-white'>{formatItemName({name: cloudSyncName(cloud)})}</span>
				</div>
			))}
		</div>
	)

	return (
		<AlertDialog open onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t('files-cloud.disconnect-confirm-title', {account: account.displayName})}
					</AlertDialogTitle>
					<AlertDialogDescription className='flex flex-col gap-3'>
						<CloudBreakDiagram provider={cloudAccountBrand(account)} />
						<span>
							{clouds.length > 0
								? t('files-cloud.disconnect-confirm-message')
								: t('files-cloud.disconnect-confirm-message-empty')}
						</span>
						{clouds.length > 0 &&
							(needsScroll ? (
								<div className='h-[200px] overflow-hidden rounded-xl bg-black/20'>
									<ScrollArea className='h-full'>
										<div className='p-4'>
											<FoldersList />
										</div>
									</ScrollArea>
								</div>
							) : (
								<div className='rounded-xl bg-black/20'>
									<FoldersList />
								</div>
							))}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						variant='destructive'
						onClick={() => {
							removeAccount(
								account.id,
								clouds.map(({id}) => id),
							).catch(() => {})
							onOpenChange(false)
						}}
					>
						{t('files-cloud.disconnect-confirm-action')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
