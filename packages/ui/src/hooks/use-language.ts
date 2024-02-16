import i18next from 'i18next'

export function useLanguage() {
	const setLanguage = (code: string) => {
		localStorage.setItem('i18nextLng', code)
		window.location.reload()
	}

	// Return `as const` so it's typed as a tuple
	return [i18next.language, setLanguage] as const
}

export const languages = [
	{name: 'English', code: 'en'},
	{name: 'Deutsch', code: 'de'},
	{name: 'Español', code: 'es'},
	{name: 'Français', code: 'fr'},
	{name: 'Italiano', code: 'it'},
	{name: 'Nederlands', code: 'nl'},
	{name: 'Português', code: 'pt'},
	{name: '日本語', code: 'ja'},
]
