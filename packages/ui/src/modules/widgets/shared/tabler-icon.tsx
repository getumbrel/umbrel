import {HTMLProps, useEffect, useState} from 'react'

import {cn} from '@/shadcn-lib/utils'

function sanitizeIconName(input: string) {
	return input.replace(/[^a-z0-9-]/g, '')
}

const customIcons = ['system-widget-memory', 'system-widget-storage', 'system-widget-temperature', 'system-widget-cpu']

export function TablerIcon({iconName, className, ...props}: {iconName: string} & HTMLProps<HTMLDivElement>) {
	const [icon, setIcon] = useState('')

	useEffect(() => {
		const url = customIcons.includes(iconName)
			? `/figma-exports/${sanitizeIconName(iconName)}.svg`
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
			className={cn(className, !icon && 'rounded-5 bg-white/5', icon && 'duration-300 animate-in fade-in')}
			dangerouslySetInnerHTML={{__html: icon}}
			{...props}
		/>
	)
}
