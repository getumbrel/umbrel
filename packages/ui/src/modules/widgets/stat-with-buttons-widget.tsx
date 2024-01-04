import {useContext, useEffect, useState} from 'react'

import {cn} from '@/shadcn-lib/utils'

import {StatText} from './progress-widget'
import {BackdropBlurVariantContext} from './shared/backdrop-blur-context'
import {widgetContainerCva} from './shared/shared'
import {WidgetButtonLink} from './shared/widget-button-link'

export function ConnectedStatWithButtonsWidget({endpoint}: {endpoint: string}) {
	const [isLoading, setIsLoading] = useState(true)
	const [isError, setIsError] = useState(false)
	const [props, setProps] = useState<Parameters<typeof StatWithButtonsWidget>[0]>()

	useEffect(() => {
		setIsLoading(true)
		fetch(endpoint)
			.then((res) => res.json())
			.then((data) => {
				console.log(data)
				setIsLoading(false)
				setProps(data)
			})
			.catch(() => setIsError(true))
	}, [endpoint])

	const variant = useContext(BackdropBlurVariantContext)

	if (isError) {
		return <div className={widgetContainerCva({variant})}>Error</div>
	}

	if (isLoading) {
		return <div className={widgetContainerCva({variant})}></div>
	}

	return <StatWithButtonsWidget {...props} />
}

export function StatWithButtonsWidget({
	title,
	value,
	valueSub,
	buttons,
}: {
	title?: string
	value?: string
	valueSub?: string
	buttons?: {
		icon: string
		title: string
		endpoint: string
	}[]
}) {
	const variant = useContext(BackdropBlurVariantContext)
	return (
		<div className={cn(widgetContainerCva({variant}), 'gap-0 p-2 md:p-5')}>
			<StatText title={title} value={value} valueSub={valueSub} />
			<div className='flex-1' />
			<div className='grid gap-1 md:grid-cols-2'>
				{buttons?.map((button) => (
					// Not using endpoint for `key` in case user wants two buttons to link to the same endpoint for some reason
					<WidgetButtonLink key={button.title} href={button.endpoint}>
						{button.icon && <img src={button.icon} alt='icon' className='mr-1 h-4 w-4' width={16} height={16} />}
						<span className='truncate'>{button.title}</span>
					</WidgetButtonLink>
				))}
			</div>
		</div>
	)
}
