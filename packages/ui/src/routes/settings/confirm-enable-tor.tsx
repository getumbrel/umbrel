import {useNavigate} from 'react-router-dom'

import {TorIcon2} from '@/assets/tor-icon2'
import {useTorEnabled} from '@/hooks/use-tor-enabled'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
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
import {afterDelayedClose} from '@/utils/dialog'

export default function ConfirmEnableTorDialog() {
	useUmbrelTitle('Restart')
	const navigate = useNavigate()

	const {setEnabled, isError} = useTorEnabled()

	if (isError) {
		throw new Error('Failed to enable.')
	}

	return (
		<AlertDialog defaultOpen onOpenChange={afterDelayedClose(() => navigate('/settings', {preventScrollReset: true}))}>
			<AlertDialogContent>
				<AlertDialogHeader icon={TorIcon2}>
					<AlertDialogTitle>Enable Tor for remote access</AlertDialogTitle>
					<AlertDialogDescription>This will restart your Umbrel and it may take a few minutes.</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						variant='destructive'
						className='px-6'
						onClick={(e) => {
							// Prevent closing by default
							setEnabled(true)
						}}
					>
						Restart & enable Tor <span className='text-11 opacity-40'>↵</span>
					</AlertDialogAction>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
