import {ComponentPropsWithRef, useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {map} from 'remeda'

import {toast} from '@/components/ui/toast'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {tempDescriptionsKeyed, useTempUnit} from '@/hooks/use-temp-unit'
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
import {StatWithButtonsWidget} from './stat-with-buttons-widget'
import {StatWithProgressWidget} from './stat-with-progress-widget'
import {ThreeStatsWidget} from './three-stats-widget'
import {TwoStatsWidget} from './two-stats-with-progress-widget'

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

	if (isLoading || widgetQ.isError) return <LoadingWidget type={manifestConfig.type} />

	const widget = widgetQ.data as WidgetConfig

	const handleClick = (link?: string) => {
		if (appId === 'live-usage' && systemAppsKeyed['UMBREL_live-usage']) {
			navigate('/?dialog=live-usage')
		} else if (app) {
			// Launching directly because it's weird to have credentials show up
			// Users will likely open the app by clicking the icon before adding a widget associated with the app
			launchApp(appId, {path: link, direct: true})
		} else {
			toast.error(`App "${appId}" not found.`)
		}
	}

	switch (manifestConfig.type) {
		case 'stat-with-buttons': {
			const w = widget as WidgetConfig<'stat-with-buttons'>
			return <StatWithButtonsWidget {...w} onClick={handleClick} />
		}
		case 'stat-with-progress': {
			const w = widget as WidgetConfig<'stat-with-progress'>
			return <StatWithProgressWidget {...w} onClick={handleClick} />
		}
		case 'two-stats-with-progress': {
			const w = widget as WidgetConfig<'two-stats-with-progress'>
			return <TwoStatsWidget {...w} onClick={handleClick} />
		}
		case 'three-stats': {
			const w = widget as WidgetConfig<'three-stats'>
			// TODO: figure out how to show the user's desired temp unit from local storage in a way that isn't brittle
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

// Hacky way to get the right temp unit based on user preferences
export function SystemThreeUpWidget({items, ...props}: ComponentPropsWithRef<typeof ThreeStatsWidget>) {
	const [tempUnit] = useTempUnit()

	if (!items) return <ErrorWidget error='No data.' />

	const modifiedItems = map.strict(items, (item) => {
		if (!item.value?.includes('℃')) return item
		const celciusNumber = parseInt(item.value.replace('℃', ''))
		const tempNumber = tempUnit === 'f' ? celciusToFahrenheit(celciusNumber) : celciusNumber
		const tempUnitLabel = tempDescriptionsKeyed[tempUnit].label
		const newValue = tempNumber + tempUnitLabel
		return {...item, value: newValue}
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
		case 'stat-with-buttons': {
			const w = example as WidgetConfig<'stat-with-buttons'>
			const widgetWithButtonLinks = {
				...w,
				// Link to nowhere
				buttons: w.buttons.map((button) => ({...button, link: ''})),
			}
			return <StatWithButtonsWidget {...widgetWithButtonLinks} />
		}
		case 'stat-with-progress': {
			const w = example as WidgetConfig<'stat-with-progress'>
			return <StatWithProgressWidget {...w} />
		}
		case 'two-stats-with-progress': {
			const w = example as WidgetConfig<'two-stats-with-progress'>
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

export function LoadingWidget<T extends WidgetType = WidgetType>({type}: {type: T}) {
	switch (type) {
		case 'stat-with-buttons': {
			return <StatWithButtonsWidget />
		}
		case 'stat-with-progress': {
			return <StatWithProgressWidget />
		}
		case 'two-stats-with-progress': {
			return <TwoStatsWidget />
		}
		case 'three-stats': {
			return <ThreeStatsWidget />
		}
		case 'four-stats': {
			return <FourStatsWidget />
		}
		case 'list': {
			return <ListWidget />
		}
		case 'list-emoji': {
			return <ListEmojiWidget />
		}
	}
}

export function ErrorWidget({error}: {error: string}) {
	return <WidgetContainer className='p-5 text-12 text-destructive2-lightest'>{error}</WidgetContainer>
}
