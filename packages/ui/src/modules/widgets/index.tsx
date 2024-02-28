import {ComponentPropsWithRef} from 'react'
import {useNavigate} from 'react-router-dom'
import {map} from 'remeda'

import {toast} from '@/components/ui/toast'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {tempDescriptionsKeyed, useTempUnit} from '@/hooks/use-temp-unit'
import {ExampleWidgetConfig, RegistryWidget, WidgetConfig, WidgetType} from '@/modules/widgets/shared/constants'
import {useApps} from '@/providers/apps'
import {trpcReact} from '@/trpc/trpc'
import {celciusToFahrenheit} from '@/utils/tempurature'

import {FourUpWidget} from './four-up-widget'
import {ListEmojiWidget} from './list-emoji-widget'
import {ListWidget} from './list-widget'
import {ProgressWidget} from './progress-widget'
import {WidgetContainer} from './shared/shared'
import {StatWithButtonsWidget} from './stat-with-buttons-widget'
import {ThreeUpWidget} from './three-up-widget'
import {TwoUpWidget} from './two-up-widget'

const DEFAULT_REFRESH_MS = 1000 * 60 * 5

export function Widget({appId, config}: {appId: string; config: RegistryWidget}) {
	// TODO: find a way to use `useApp()` to be cleaner
	const {userAppsKeyed, systemAppsKeyed, isLoading: isLoadingApps} = useApps()
	const app = userAppsKeyed?.[appId]
	// const finalEndpointUrl = urlJoin(appToUrlWithAppPath(app), config.endpoint);

	const widgetQ = trpcReact.widget.data.useQuery(
		{widgetId: config.id},
		{
			retry: false,
			// We do want refetching to happen on a schedule though
			refetchInterval: config.refresh ?? DEFAULT_REFRESH_MS,
		},
	)

	const navigate = useNavigate()
	const launchApp = useLaunchApp()

	const isLoading = isLoadingApps || widgetQ.isLoading

	if (widgetQ.isError) {
		return <ErrorWidget error='Error processing widget.' />
	}
	// TODO: Show correct widget type while loading, not just empty container
	if (isLoading) return <LoadingWidget type={config.type} />

	const widget = widgetQ.data as WidgetConfig

	const handleClick = (link?: string) => {
		if (appId === 'live-usage' && systemAppsKeyed.settings) {
			navigate('/?dialog=live-usage')
		} else if (app) {
			// Launching directly because it's weird to have credentials show up
			// Users will likely open the app by clicking the icon before adding a widget associated with the app
			launchApp(appId, {path: link, direct: true})
		} else {
			toast.error(`App "${appId}" not found.`)
		}
	}

	switch (config.type) {
		case 'stat-with-buttons': {
			const w = widget as WidgetConfig<'stat-with-buttons'>
			return <StatWithButtonsWidget {...w} onClick={handleClick} />
		}
		case 'stat-with-progress': {
			const w = widget as WidgetConfig<'stat-with-progress'>
			return <ProgressWidget {...w} onClick={handleClick} />
		}
		case 'two-up-stat-with-progress': {
			const w = widget as WidgetConfig<'two-up-stat-with-progress'>
			return <TwoUpWidget {...w} onClick={handleClick} />
		}
		case 'three-up': {
			const w = widget as WidgetConfig<'three-up'>
			// TODO: figure out how to show the user's desired temp unit from local storage in a way that isn't brittle
			if (config.id === 'umbrel:system-stats') {
				return <SystemThreeUpWidget {...w} onClick={handleClick} />
			}
			return <ThreeUpWidget {...w} onClick={handleClick} />
		}
		case 'four-up': {
			const w = widget as WidgetConfig<'four-up'>
			return <FourUpWidget {...w} onClick={handleClick} />
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
export function SystemThreeUpWidget({items, ...props}: ComponentPropsWithRef<typeof ThreeUpWidget>) {
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
	return <ThreeUpWidget items={modifiedItems} {...props} />
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
			return <ProgressWidget {...w} />
		}
		case 'two-up-stat-with-progress': {
			const w = example as WidgetConfig<'two-up-stat-with-progress'>
			return <TwoUpWidget {...w} />
		}
		case 'three-up': {
			const w = example as WidgetConfig<'three-up'>
			return <ThreeUpWidget {...w} />
		}
		case 'four-up': {
			const w = example as WidgetConfig<'four-up'>
			return <FourUpWidget {...w} />
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
			return <ProgressWidget />
		}
		case 'two-up-stat-with-progress': {
			return <TwoUpWidget />
		}
		case 'three-up': {
			return <ThreeUpWidget />
		}
		case 'four-up': {
			return <FourUpWidget />
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
