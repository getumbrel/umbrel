import {useEffect, useState} from 'react'

// How a foldable is being held. A book's fold runs down the glass and a laptop's
// runs across it; flat is everything else, including the fold laid open.
export type Fold = {
	pose: 'flat' | 'book' | 'laptop'
	// Where the first segment ends along the axis that's split, in CSS pixels
	at: number
}

const POSTURE_QUERY = '(device-posture: folded)'
const BOOK_QUERY = '(horizontal-viewport-segments: 2)'
const LAPTOP_QUERY = '(vertical-viewport-segments: 2)'
const FLAT: Fold = {pose: 'flat', at: 0}

// The Device Posture and Viewport Segments APIs, previews behind feature flags in
// Safari 27.1 and shipped in Chrome. This reads their CSS side because
// navigator.devicePosture needs a secure page, and umbrelOS is usually plain HTTP.
// Segments say where the fold is and posture says whether it's bent: a display
// lying flat still reports two segments.
export function readFold(probe: HTMLElement): Fold {
	const posture = matchMedia(POSTURE_QUERY)
	const book = matchMedia(BOOK_QUERY)
	const laptop = matchMedia(LAPTOP_QUERY)
	const hasPosture = posture.media !== 'not all'
	if ((hasPosture && !posture.matches) || !(book.matches || laptop.matches)) return FLAT
	const {width, height} = probe.getBoundingClientRect()
	return book.matches ? {pose: 'book', at: width} : {pose: 'laptop', at: height}
}

export function useFold() {
	const [fold, setFold] = useState(FLAT)

	useEffect(() => {
		const probe = document.createElement('div')
		probe.style.cssText =
			'position:fixed;visibility:hidden;pointer-events:none;width:env(viewport-segment-right 0 0, 0px);height:env(viewport-segment-bottom 0 0, 0px)'
		document.body.append(probe)
		const update = () =>
			setFold((current) => {
				const next = readFold(probe)
				return next.pose === current.pose && next.at === current.at ? current : next
			})
		update()
		const queries = [POSTURE_QUERY, BOOK_QUERY, LAPTOP_QUERY].map((query) => matchMedia(query))
		for (const query of queries) query.addEventListener('change', update)
		window.addEventListener('resize', update)
		return () => {
			probe.remove()
			for (const query of queries) query.removeEventListener('change', update)
			window.removeEventListener('resize', update)
		}
	}, [])

	return fold
}
