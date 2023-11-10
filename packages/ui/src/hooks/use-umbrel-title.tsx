import {useEffect} from 'react'

export function useUmbrelTitle(title: string) {
	useEffect(() => {
		// Allow hook to do nothing if no title provided
		if (!title) return

		const prevTitle = document.title
		document.title = `${title} – Umbrel`
		return () => {
			document.title = prevTitle
		}
	}, [title])
}
