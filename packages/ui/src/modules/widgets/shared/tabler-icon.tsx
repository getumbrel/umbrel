import {HTMLProps, useEffect, useState} from 'react'

import cpuIcon from '@/assets/widgets/system-widget-cpu.svg?no-inline'
import memoryIcon from '@/assets/widgets/system-widget-memory.svg?no-inline'
import storageIcon from '@/assets/widgets/system-widget-storage.svg?no-inline'
import temperatureIcon from '@/assets/widgets/system-widget-temperature.svg?no-inline'
import {cn} from '@/lib/utils'

function sanitizeIconName(input: string) {
	return input.replace(/[^a-z0-9-]/g, '')
}

const customIcons: Record<string, string> = {
	'system-widget-memory': memoryIcon,
	'system-widget-storage': storageIcon,
	'system-widget-temperature': temperatureIcon,
	'system-widget-cpu': cpuIcon,
}

export function TablerIcon({iconName, className, ...props}: {iconName: string} & HTMLProps<HTMLDivElement>) {
	const [icon, setIcon] = useState('')

	useEffect(() => {
		const url = Object.hasOwn(customIcons, iconName)
			? customIcons[iconName]
			: `/generated-tabler-icons/${sanitizeIconName(iconName)}.svg`
		fetch(url)
			.then((res) => res.text())
			.then((res) => {
				if (res.startsWith('<svg')) return setIcon(res)
				console.error(`Icon: "${iconName}.svg" not found`)
				return setIcon('')
			})
	}, [iconName])

	return (
		<div
			className={cn(className, !icon && 'rounded-5 bg-white/5', icon && 'animate-in duration-300 fade-in')}
			dangerouslySetInnerHTML={{__html: icon}}
			{...props}
		/>
	)
}
