import {RiLogoutCircleRLine} from 'react-icons/ri'
import {Link} from 'react-router-dom'

import {DialogMounter} from '@/components/dialog-mounter'
import {linkClass} from '@/components/element-classes'
import {useQueryParams} from '@/hooks/use-query-params'
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

export function LogoutDialog() {
	const {params, removeParam} = useQueryParams()

	const handleLogout = () => {
		window.localStorage.removeItem('jwt')
		// Hard navigate to `/login` to force all parent layouts to re-render
		window.location.href = '/login'
	}

	return (
		<DialogMounter>
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
						<AlertDialogAction variant='destructive' className='px-6' onClick={handleLogout}>
							Log out <span className='text-11 opacity-40'>↵</span>
						</AlertDialogAction>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</DialogMounter>
	)
}
