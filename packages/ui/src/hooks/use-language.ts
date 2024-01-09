import {useTranslation} from 'react-i18next'
import {useLocalStorage} from 'react-use'

export function useLanguage() {
	const {i18n} = useTranslation()
	const [activeCode, setActiveCode] = useLocalStorage('i18nextLng', 'en', {
		raw: true,
	})

	const setLanguage = (code: string) => {
		setActiveCode(code)
		i18n.changeLanguage(code)
	}

	// Return `as const` so it's typed as a tuple
	return [activeCode, setLanguage] as const
}

export const languages = [
	{name: 'English', code: 'en'},
	{name: 'Français', code: 'fr'},
	{name: 'العربية', code: 'ar'},
]
