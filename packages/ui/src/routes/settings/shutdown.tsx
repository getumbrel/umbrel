import {RiShutDownLine} from 'react-icons/ri'
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

export function ShutdownDialog() {
	useUmbrelTitle('Shut down')
	const navigate = useNavigate()

	return (
		<DialogMounter>
			<AlertDialog
				defaultOpen
				onOpenChange={afterDelayedClose(() => navigate('/settings', {preventScrollReset: true}))}
			>
				<AlertDialogContent>
					<AlertDialogHeader icon={RiShutDownLine}>
						<AlertDialogTitle>Are you sure you want to shut down your Umbrel?</AlertDialogTitle>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction variant='destructive'>
							Shut down <span className='text-11 opacity-40'>↵</span>
						</AlertDialogAction>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</DialogMounter>
	)
}
