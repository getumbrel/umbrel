import {useEffect} from 'react'

export function useUmbrelTitle(title: string) {
	useEffect(() => {
		if (!title) return
		const prevTitle = document.title
		document.title = `${title} – Umbrel`
		return () => {
			document.title = prevTitle
		}
	}, [title])
}
