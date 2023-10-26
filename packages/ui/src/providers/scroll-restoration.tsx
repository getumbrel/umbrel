import React, {createContext, ReactNode, RefObject, useContext, useEffect, useState} from 'react'
import {useLocation} from 'react-router-dom'

interface ScrollContextProps {
	scrollPositions: Record<string, number>
	registerScrollElement: (key: string, ref: RefObject<HTMLElement>) => void
}

const ScrollRestorationContext = createContext<ScrollContextProps | undefined>(undefined)

interface ScrollRestorationProviderProps {
	children: ReactNode
}

export const ScrollRestorationProvider: React.FC<ScrollRestorationProviderProps> = ({children}) => {
	const [scrollPositions, setScrollPositions] = useState<Record<string, number>>({})
	const [scrollElements, setScrollElements] = useState<Record<string, RefObject<HTMLElement>>>({})
	const location = useLocation()

	const registerScrollElement = (key: string, ref: RefObject<HTMLElement>) => {
		setScrollElements((prevElements) => ({
			...prevElements,
			[key]: ref,
		}))
	}

	useEffect(() => {
		// Save current scroll positions before location change
		const newScrollPositions: Record<string, number> = {}
		for (const [key, ref] of Object.entries(scrollElements)) {
			if (ref.current) {
				newScrollPositions[key] = ref.current.scrollTop
			}
		}
		setScrollPositions(newScrollPositions)

		// Optional: Clear scroll positions if you don't want to retain the positions after navigating away
		// setScrollPositions({});
	}, [location, scrollElements])

	return (
		<ScrollRestorationContext.Provider value={{scrollPositions, registerScrollElement}}>
			{children}
		</ScrollRestorationContext.Provider>
	)
}

export const useScrollRestoration = (ref: RefObject<HTMLElement>, key: string): void => {
	const {scrollPositions, registerScrollElement} = useContext(ScrollRestorationContext) as ScrollContextProps

	useEffect(() => {
		registerScrollElement(key, ref)

		// Restore scroll position when component mounts
		const element = ref.current
		if (element && scrollPositions[key] !== undefined) {
			element.scrollTop = scrollPositions[key]
		}
	}, [ref, key, scrollPositions, registerScrollElement])
}
