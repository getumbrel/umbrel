import {HTMLProps, useEffect, useState} from 'react'

import {cn} from '@/lib/utils'

function sanitizeIconName(input: string) {
	return input.replace(/[^a-z0-9-]/g, '')
}

export function TablerIcon({iconName, className, ...props}: {iconName: string} & HTMLProps<HTMLDivElement>) {
	const [icon, setIcon] = useState('')

	useEffect(() => {
		const url = `/generated-tabler-icons/${sanitizeIconName(iconName)}.svg`
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
