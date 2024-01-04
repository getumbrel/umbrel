import {useContext, useEffect, useState} from 'react'

import {Progress} from '@/shadcn-components/ui/progress'
import {cn} from '@/shadcn-lib/utils'

import {BackdropBlurVariantContext} from './shared/backdrop-blur-context'
import {widgetContainerCva, widgetTextCva} from './shared/shared'

export function ConnectedProgressWidget({endpoint}: {endpoint: string}) {
	const [isLoading, setIsLoading] = useState(true)
	const [props, setProps] = useState<Parameters<typeof ProgressWidget>[0]>()

	useEffect(() => {
		setIsLoading(true)
		fetch(endpoint)
			.then((res) => res.json())
			.then((data) => {
				console.log(data)
				setIsLoading(false)
				setProps(data)
			})
	}, [endpoint])

	const variant = useContext(BackdropBlurVariantContext)

	if (isLoading) {
		return <div className={widgetContainerCva({variant})}></div>
	}

	return <ProgressWidget {...props} />
}

export function ProgressWidget({
	title,
	value,
	valueSub,
	progressLabel,
	progress = 0,
}: {
	title?: string
	value?: string
	valueSub?: string
	progressLabel?: string
	progress?: number
}) {
	const variant = useContext(BackdropBlurVariantContext)
	return (
		<div className={cn(widgetContainerCva({variant}), 'p-2 md:p-5')}>
			<StatText title={title} value={value} valueSub={valueSub} />
			<div className='flex-1' />
			{/* TODO: use shadcn progress component */}
			<div className={widgetTextCva({opacity: 'secondary'})}>{progressLabel || 'In progress'}</div>
			<Progress value={progress * 100} />
		</div>
	)
}

export function StatText({title, value, valueSub}: {title?: string; value?: string; valueSub?: string}) {
	return (
		<div className='flex flex-col gap-1 md:gap-2'>
			{title && <div className={widgetTextCva({opacity: 'secondary'})}>{title}</div>}
			<div className='truncate text-12 font-semibold leading-none -tracking-3 opacity-80 md:text-24'>
				{value}
				<span className='ml-1 text-13 font-bold opacity-[45%]'>{valueSub}</span>
			</div>
		</div>
	)
}
