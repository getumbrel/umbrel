import {SupportedLanguageCode, useLanguage} from '@/hooks/use-language'
import {useLocalStorage2} from '@/hooks/use-local-storage2'
import {keyBy} from '@/utils/misc'

const langCodesWithFahrenheitTemp: SupportedLanguageCode[] = ['en']

export const tempDescriptions = [
	{id: 'c', label: '°C'},
	{id: 'f', label: '°F'},
] as const

export type TempUnit = (typeof tempDescriptions)[number]['id']

export const tempDescriptionsKeyed = keyBy(tempDescriptions, 'id')

export function useTempUnit(optionalUnit?: TempUnit): [unit: TempUnit, setTemp: (unit: TempUnit) => void] {
	// Get default unit from the user's language
	const [langCode] = useLanguage()
	const langUnit = langCodesWithFahrenheitTemp.includes(langCode) ? 'f' : 'c'

	const defaultUnit = optionalUnit ?? langUnit

	// Not setting a default in `useLocalStorage2` because it would set the local storage value, which we don't want.
	// We want the unit to depend on the user language until the user specifically toggles to the a different temp unit.
	// Once they set the unit they want, we don't wanna change it even if they change the language.
	const [unit, setUnit] = useLocalStorage2<TempUnit>('temp-unit')

	return [unit ?? defaultUnit, setUnit]
}
