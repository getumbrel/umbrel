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
import {useDialogOpenProps} from '@/utils/dialog'

export default function ConfirmEnableTorDialog() {
	useUmbrelTitle('Restart')
	const dialogProps = useDialogOpenProps('tor')

	const {setEnabled, isError} = useTorEnabled()

	if (isError) {
		throw new Error('Failed to enable.')
	}

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader icon={TorIcon2}>
					<AlertDialogTitle>Enable Tor for remote access</AlertDialogTitle>
					<AlertDialogDescription>This will restart your Umbrel and it may take a few minutes.</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						variant='destructive'
						className='px-6'
						onClick={() => {
							// Prevent closing by default
							setEnabled(true)
						}}
					>
						Restart & enable Tor
					</AlertDialogAction>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
