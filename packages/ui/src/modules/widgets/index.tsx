import {ComponentPropsWithRef, useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {map} from 'remeda'

import {toast} from '@/components/ui/toast'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {temperatureDescriptionsKeyed, useTemperatureUnit} from '@/hooks/use-temperature-unit'
import {
	DEFAULT_REFRESH_MS,
	ExampleWidgetConfig,
	RegistryWidget,
	WidgetConfig,
	WidgetType,
} from '@/modules/widgets/shared/constants'
import {useApps} from '@/providers/apps'
import {trpcReact} from '@/trpc/trpc'
import {celciusToFahrenheit} from '@/utils/temperature'

import {FourStatsWidget} from './four-stats-widget'
import {ListEmojiWidget} from './list-emoji-widget'
import {ListWidget} from './list-widget'
import {WidgetContainer} from './shared/shared'
import {TextWithButtonsWidget} from './text-with-buttons-widget'
import {TextWithProgressWidget} from './text-with-progress-widget'
import {ThreeStatsWidget} from './three-stats-widget'
import {TwoStatsWidget} from './two-stats-with-guage-widget'

export function Widget({appId, config: manifestConfig}: {appId: string; config: RegistryWidget}) {
	// TODO: find a way to use `useApp()` to be cleaner
	const {userAppsKeyed, systemAppsKeyed, isLoading: isLoadingApps} = useApps()
	const app = userAppsKeyed?.[appId]
	// const finalEndpointUrl = urlJoin(appToUrlWithAppPath(app), config.endpoint);

	const [refetchInterval, setRefetchInterval] = useState(manifestConfig.refresh ?? DEFAULT_REFRESH_MS)

	const widgetQ = trpcReact.widget.data.useQuery(
		{widgetId: manifestConfig.id},
		{
			retry: false,
			// We do want refetching to happen on a schedule though
			refetchInterval,
		},
	)

	// Update the refetch interval based on the widget config, not the manifest config
	// This makes the widget refresh interval dynamic
	const widgetConfigRefresh = (widgetQ.data as WidgetConfig)?.refresh
	useEffect(() => {
		if (!widgetConfigRefresh) return
		setRefetchInterval(widgetConfigRefresh)
	}, [widgetConfigRefresh])

	const navigate = useNavigate()
	const launchApp = useLaunchApp()

	const isLoading = isLoadingApps || widgetQ.isLoading

	const handleClick = (link?: string) => {
		if (appId === 'live-usage' && systemAppsKeyed['UMBREL_live-usage']) {
			navigate(link || '?dialog=live-usage')
		} else if (app) {
			// Launching directly because it's weird to have credentials show up
			// Users will likely open the app by clicking the icon before adding a widget associated with the app
			launchApp(appId, {path: link, direct: true})
		} else {
			toast.error(`App "${appId}" not found.`)
		}
	}

	if (isLoading || widgetQ.isError) return <LoadingWidget type={manifestConfig.type} onClick={handleClick} />

	const widget = widgetQ.data as WidgetConfig

	switch (manifestConfig.type) {
		case 'text-with-buttons': {
			const w = widget as WidgetConfig<'text-with-buttons'>
			return <TextWithButtonsWidget {...w} onClick={handleClick} />
		}
		case 'text-with-progress': {
			const w = widget as WidgetConfig<'text-with-progress'>
			return <TextWithProgressWidget {...w} onClick={handleClick} />
		}
		case 'two-stats-with-guage': {
			const w = widget as WidgetConfig<'two-stats-with-guage'>
			return <TwoStatsWidget {...w} onClick={handleClick} />
		}
		case 'three-stats': {
			const w = widget as WidgetConfig<'three-stats'>
			// TODO: figure out how to show the user's desired temp unit in a way that isn't brittle
			if (manifestConfig.id === 'umbrel:system-statss') {
				return <SystemThreeUpWidget {...w} onClick={handleClick} />
			}
			return <ThreeStatsWidget {...w} onClick={handleClick} />
		}
		case 'four-stats': {
			const w = widget as WidgetConfig<'four-stats'>
			return <FourStatsWidget {...w} onClick={handleClick} />
		}
		case 'list': {
			const w = widget as WidgetConfig<'list'>
			return <ListWidget {...w} onClick={handleClick} />
		}
		case 'list-emoji': {
			const w = widget as WidgetConfig<'list-emoji'>
			return <ListEmojiWidget {...w} onClick={handleClick} />
		}
	}
}

// Hacky way to get the right temperature unit based on user preferences
export function SystemThreeUpWidget({items, ...props}: ComponentPropsWithRef<typeof ThreeStatsWidget>) {
	const [temperatureUnit] = useTemperatureUnit()

	if (!items) return <ErrorWidget error='No data.' />

	const modifiedItems = map.strict(items, (item) => {
		if (!item.text?.includes('℃')) return item
		const celciusNumber = parseInt(item.text.replace('℃', ''))
		const temperatureNumber = temperatureUnit === 'f' ? celciusToFahrenheit(celciusNumber) : celciusNumber
		const temperatureUnitLabel = temperatureDescriptionsKeyed[temperatureUnit].label
		const newValue = temperatureNumber + temperatureUnitLabel
		return {...item, text: newValue}
	})
	return <ThreeStatsWidget items={modifiedItems} {...props} />
}

export function ExampleWidget<T extends WidgetType = WidgetType>({
	type,
	example,
}: {
	type: T
	example?: ExampleWidgetConfig<T>
}) {
	switch (type) {
		case 'text-with-buttons': {
			const w = example as WidgetConfig<'text-with-buttons'>
			const widgetWithButtonLinks = {
				...w,
				// Link to nowhere
				buttons: w.buttons?.map((button) => ({...button, link: ''})),
			}
			return <TextWithButtonsWidget {...widgetWithButtonLinks} />
		}
		case 'text-with-progress': {
			const w = example as WidgetConfig<'text-with-progress'>
			return <TextWithProgressWidget {...w} />
		}
		case 'two-stats-with-guage': {
			const w = example as WidgetConfig<'two-stats-with-guage'>
			return <TwoStatsWidget {...w} />
		}
		case 'three-stats': {
			const w = example as WidgetConfig<'three-stats'>
			return <ThreeStatsWidget {...w} />
		}
		case 'four-stats': {
			const w = example as WidgetConfig<'four-stats'>
			return <FourStatsWidget {...w} />
		}
		case 'list': {
			const w = example as WidgetConfig<'list'>
			return <ListWidget {...w} />
		}
		case 'list-emoji': {
			const w = example as WidgetConfig<'list-emoji'>
			return <ListEmojiWidget {...w} />
		}
	}
}

export function LoadingWidget<T extends WidgetType = WidgetType>({type, onClick}: {type: T; onClick?: () => void}) {
	switch (type) {
		case 'text-with-buttons': {
			return <TextWithButtonsWidget onClick={onClick} />
		}
		case 'text-with-progress': {
			return <TextWithProgressWidget onClick={onClick} />
		}
		case 'two-stats-with-guage': {
			return <TwoStatsWidget onClick={onClick} />
		}
		case 'three-stats': {
			return <ThreeStatsWidget onClick={onClick} />
		}
		case 'four-stats': {
			return <FourStatsWidget onClick={onClick} />
		}
		case 'list': {
			return <ListWidget onClick={onClick} />
		}
		case 'list-emoji': {
			return <ListEmojiWidget onClick={onClick} />
		}
	}
}

export function ErrorWidget({error}: {error: string}) {
	return <WidgetContainer className='p-5 text-12 text-destructive2-lightest'>{error}</WidgetContainer>
}
