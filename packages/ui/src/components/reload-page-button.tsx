import {Button} from '@/shadcn-components/ui/button'
import {t} from '@/utils/i18n'

export function ReloadPageButton() {
	return (
		<Button variant='secondary' size='sm' onClick={() => window.location.reload()}>
			{t('retry')}
		</Button>
	)
}
