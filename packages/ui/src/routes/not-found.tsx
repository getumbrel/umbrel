import {useNavigate} from 'react-router-dom'

import {Wallpaper} from '@/modules/desktop/wallpaper-context'
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

export function NotFound() {
	const navigate = useNavigate()

	return (
		<>
			<Wallpaper />
			<AlertDialog open={true}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Not Found: 404</AlertDialogTitle>
						<AlertDialogDescription></AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => navigate(-1)}>Back</AlertDialogCancel>
						<AlertDialogAction onClick={() => navigate('/')}>Home</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
