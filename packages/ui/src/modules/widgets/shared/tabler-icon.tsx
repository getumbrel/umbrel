import {HTMLProps, useEffect, useState} from 'react'

function sanitizeIconName(input: string) {
	return input.replace(/[^a-z0-9-]/g, '')
}

const customIcons = ['system-widget-memory', 'system-widget-storage', 'system-widget-temperature']

export function TablerIcon({iconName, ...props}: {iconName: string} & HTMLProps<HTMLDivElement>) {
	const [icon, setIcon] = useState('')

	useEffect(() => {
		const url = customIcons.includes(iconName)
			? `/figma-exports/${sanitizeIconName(iconName)}.svg`
			: `/generated-tabler-icons/${sanitizeIconName(iconName)}.svg`
		fetch(url)
			.then((res) => res.text())
			.then((res) => {
				if (res.startsWith('<svg')) return setIcon(res)
				console.error(`Icon: "${name}.svg" not found in ${process.env.PUBLIC_URL}/icons`)
				return setIcon('')
			})
	}, [iconName])

	return <div dangerouslySetInnerHTML={{__html: icon}} {...props} />
}
