import {RiLogoutCircleRLine} from 'react-icons/ri'
import {Link} from 'react-router-dom'

import {useQueryParams} from '@/hooks/use-query-params'
import {useAuth} from '@/modules/auth/use-auth'
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
import {linkClass} from '@/utils/element-classes'

export function LogoutDialog() {
	const {params, removeParam} = useQueryParams()
	const {logout} = useAuth()

	return (
		<AlertDialog open={params.get('dialog') === 'logout'} onOpenChange={(open) => !open && removeParam('dialog')}>
			<AlertDialogContent>
				<AlertDialogHeader icon={RiLogoutCircleRLine}>
					<AlertDialogTitle>Are you sure you want to log out?</AlertDialogTitle>
					<AlertDialogDescription>
						If you don’t want to re-confirm again, change it in the{' '}
						<Link to='/settings' className={linkClass}>
							Settings
						</Link>
						.
					</AlertDialogDescription>
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
