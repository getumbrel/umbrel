import {RiLogoutCircleRLine} from 'react-icons/ri'

import {useAuth} from '@/modules/auth/use-auth'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import {useDialogOpenProps} from '@/utils/dialog'

export function LogoutDialog() {
	// TODO: Enable hook below after this component is only injected as needed rather than all the time
	// useUmbrelTitle('Log out')
	const dialogProps = useDialogOpenProps('logout')
	const {logout} = useAuth()

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader icon={RiLogoutCircleRLine}>
					<AlertDialogTitle>Are you sure you want to log out?</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction variant='destructive' className='px-6' onClick={logout}>
						Log out
					</AlertDialogAction>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
