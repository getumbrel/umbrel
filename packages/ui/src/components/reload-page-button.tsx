import {Button} from '@/shadcn-components/ui/button'

export function ReloadPageButton() {
	return (
		<Button variant='secondary' size='sm' onClick={() => window.location.reload()}>
			Reload Page
		</Button>
	)
}
