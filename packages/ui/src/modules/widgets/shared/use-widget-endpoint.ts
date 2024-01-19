import {useState} from 'react'
import {useEffectOnce, useInterval} from 'react-use'

import {WidgetConfig, WidgetType} from '@/trpc/trpc'

export function useWidgetEndpoint(endpoint: string, type: WidgetType) {
	type WidgetT = WidgetConfig<typeof type>
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)
	const [widget, setWidget] = useState<WidgetT | undefined>()

	const fetchIt = () => {
		setError(null)
		fetch(endpoint)
			.then((res) => res.json())
			.then((data) => {
				setIsLoading(false)
				setWidget(data as WidgetT)
			})
			.catch(setError)
		// Call every 5 minutes
	}

	useEffectOnce(fetchIt)
	// TODO: use react-query for this
	useInterval(fetchIt, 1000 * 60 * 5)

	const isError = error !== null

	if (isLoading) {
		return {
			isLoading: true,
			isError: false,
			error: null,
			widget: undefined,
		}
	}

	if (widget === undefined) {
		return {
			isLoading: false,
			isError: true,
			error: new Error('No data'),
			widget: undefined,
		}
	}

	return {
		isLoading,
		isError,
		error,
		widget,
	}
}
