import {useLanguage} from '@/hooks/use-language'
import {trpcReact} from '@/trpc/trpc'
import {SupportedLanguageCode} from '@/utils/language'
import {keyBy} from '@/utils/misc'

const languageCodesWithFahrenheitTemperature: SupportedLanguageCode[] = ['en']

export const temperatureDescriptions = [
	{id: 'c', label: '°C'},
	{id: 'f', label: '°F'},
] as const

export type TemperatureUnit = (typeof temperatureDescriptions)[number]['id']

export const temperatureDescriptionsKeyed = keyBy(temperatureDescriptions, 'id')

export function useTemperatureUnit(
	optionalUnit?: TemperatureUnit,
): [unit: TemperatureUnit, setTemp: (unit: TemperatureUnit) => void] {
	const utils = trpcReact.useUtils()
	const userGetQ = trpcReact.user.get.useQuery()
	const userSetMut = trpcReact.user.set.useMutation({
		onSuccess() {
			utils.user.get.invalidate()
		},
	})

	const setUnit = (temperatureUnit: TemperatureUnit) => {
		userSetMut.mutate({temperatureUnit})
	}

	// Fall back to determine the unit from the user's language
	const [languageCode] = useLanguage()
	const languageUnit = languageCodesWithFahrenheitTemperature.includes(languageCode) ? 'f' : 'c'
	const defaultUnit = optionalUnit || languageUnit

	// Use preferred unit stored on the backend once set
	const preferredUnit = userGetQ.data?.temperatureUnit
	const unit = temperatureDescriptions.some((description) => preferredUnit === description.id)
		? (preferredUnit as TemperatureUnit)
		: defaultUnit

	return [unit, setUnit]
}
