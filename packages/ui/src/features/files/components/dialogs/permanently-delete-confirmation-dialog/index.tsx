import {FlameIcon} from '@/features/files/assets/flame-icon'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
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
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export default function PermanentlyDeleteConfirmationDialog() {
	const dialogProps = useDialogOpenProps('files-permanently-delete-confirmation')
	const {deleteSelectedItems} = useFilesOperations()
	const selectedItems = useFilesStore((s) => s.selectedItems)
	const needsScroll = selectedItems.length > 3

	if (selectedItems.length === 0) return null

	const ItemsList = () => (
		<div className='flex flex-col'>
			{selectedItems.map((item, index) => (
				<div
					key={`${item.path}-permanently-delete-confirmation`}
					className={`flex items-center gap-2 rounded-lg p-3 ${needsScroll && index % 2 === 0 ? 'bg-white/3' : ''}`}
				>
					<FileItemIcon item={item} className='h-8 w-8' />
					<span className='truncate text-12 text-white'>{formatItemName({name: item.name})}</span>
				</div>
			))}
		</div>
	)

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader icon={FlameIcon}>
					<AlertDialogTitle>
						{selectedItems.length === 1
							? t('files-permanently-delete.title-single')
							: t('files-permanently-delete.title-multiple', {count: selectedItems.length})}
					</AlertDialogTitle>
					<AlertDialogDescription className='flex flex-col gap-3'>
						<span>
							{selectedItems.length === 1
								? t('files-permanently-delete.description-single', {fileName: selectedItems[0].name})
								: t('files-permanently-delete.description-multiple', {count: selectedItems.length})}
						</span>
						{needsScroll ? (
							<div className='h-[200px] overflow-hidden rounded-xl bg-black/20'>
								<ScrollArea className='h-full'>
									<div className='p-4'>
										<ItemsList />
									</div>
								</ScrollArea>
							</div>
						) : (
							<div className='rounded-xl bg-black/20'>
								<ItemsList />
							</div>
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						variant='destructive'
						className='px-6'
						onClick={() => {
							deleteSelectedItems()
							dialogProps.onOpenChange(false)
						}}
					>
						{t('files-permanently-delete.confirm')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
