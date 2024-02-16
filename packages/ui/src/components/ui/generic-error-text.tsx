import {t} from '@/utils/i18n'

export function GenericErrorText() {
	return <div className='font-semibold text-destructive2-lightest'>{t('something-went-wrong')}</div>
}
