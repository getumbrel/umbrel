import {useEffect, useState} from 'react'
import {useLocalStorage} from 'react-use'

/**
 * Just like `useLocalStorage`, but a few differences:
 * - The key is prefixed with `UMBREL_`
 * - Uses an effect to prevent ssr mismatch
 * Why: https://github.com/streamich/react-use/issues/702
 */
export function useLocalStorage2<TT>(key: string, defaultValue: TT) {
	const [s2, setS2] = useState<TT | undefined>(undefined)
	const [s, ss] = useLocalStorage('UMBREL_' + key, defaultValue)

	useEffect(() => {
		setS2(s)
	}, [s])

	return [s2, ss] as const
}
