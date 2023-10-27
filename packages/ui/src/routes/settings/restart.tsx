import {RiRestartLine} from 'react-icons/ri'
import {useNavigate} from 'react-router-dom'

import {DialogMounter} from '@/components/dialog-mounter'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import {afterDelayedClose} from '@/utils/dialog'

export function RestartDialog() {
	useUmbrelTitle('Restart')
	const navigate = useNavigate()

	return (
		<DialogMounter>
			<AlertDialog
				defaultOpen
				onOpenChange={afterDelayedClose(() => navigate('/settings', {preventScrollReset: true}))}
			>
				<AlertDialogContent>
					<AlertDialogHeader icon={RiRestartLine}>
						<AlertDialogTitle>Are you sure you want to restart your Umbrel?</AlertDialogTitle>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction variant='destructive' className='px-6'>
							Restart <span className='text-11 opacity-40'>↵</span>
						</AlertDialogAction>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</DialogMounter>
	)
}
