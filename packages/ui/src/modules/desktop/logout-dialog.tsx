import {RiLogoutCircleRLine} from 'react-icons/ri'

import {useQueryParams} from '@/hooks/use-query-params'
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

export function LogoutDialog() {
	const {params, removeParam} = useQueryParams()
	const {logout} = useAuth()

	return (
		<AlertDialog open={params.get('dialog') === 'logout'} onOpenChange={(open) => !open && removeParam('dialog')}>
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
