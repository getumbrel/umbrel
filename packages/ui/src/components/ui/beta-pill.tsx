import {useTranslation} from 'react-i18next'

// A small "Beta" tag for features still stabilizing — sits inline after a row
// title or as a centered badge above fine print
export function BetaPill() {
	const {t} = useTranslation()
	return (
		<span className='rounded-full bg-brand/25 px-1.5 py-[3px] text-9 leading-none font-semibold tracking-[0.06em] text-brand-lightest uppercase'>
			{t('beta')}
		</span>
	)
}
