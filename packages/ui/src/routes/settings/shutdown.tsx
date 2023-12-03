import {RiShutDownLine} from 'react-icons/ri'
import {useNavigate} from 'react-router-dom'

import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
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
import {trpcReact} from '@/trpc/trpc'
import {afterDelayedClose} from '@/utils/dialog'

export default function ShutdownDialog() {
	useUmbrelTitle('Shut down')
	const navigate = useNavigate()

	const shutdownMut = trpcReact.system.shutdown.useMutation()

	if (shutdownMut.isLoading || shutdownMut.isError) {
		return (
			<CoverMessage>
				<Loading>Shutting down</Loading>
				<CoverMessageParagraph>
					Please do not refresh this page or turn off your Umbrel while it is shutting down.
				</CoverMessageParagraph>
			</CoverMessage>
		)
	}

	// TODO: consider just doing throw here
	if (shutdownMut.isError) {
		return <CoverMessage>Failed to shut down.</CoverMessage>
	}

	return (
		<AlertDialog defaultOpen onOpenChange={afterDelayedClose(() => navigate('/settings', {preventScrollReset: true}))}>
			<AlertDialogContent>
				<AlertDialogHeader icon={RiShutDownLine}>
					<AlertDialogTitle>Are you sure you want to shut down your Umbrel?</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						variant='destructive'
						onClick={(e) => {
							// Prevent closing by default
							e.preventDefault()
							shutdownMut.mutate()
						}}
					>
						Shut down <span className='text-11 opacity-40'>↵</span>
					</AlertDialogAction>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
