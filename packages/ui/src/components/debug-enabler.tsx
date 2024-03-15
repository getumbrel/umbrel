import {useEffect, useState} from 'react'

import {toast} from '@/components/ui/toast'

export function DebugEnabler({children}: {children: React.ReactNode}) {
	const [, setClickCount] = useState<number | undefined>(0)

	const handleClick = () => {
		setClickCount((count) => {
			if (count === undefined) return undefined

			if (count < 3) {
				return count + 1
			}

			if (localStorage.getItem('debug') === 'true') {
				localStorage.setItem('debug', 'false')
				toast('Debug mode disabled')
			} else {
				localStorage.setItem('debug', 'true')
				toast('Debug mode enabled')
			}
			setTimeout(() => {
				window.location.reload()
			}, 1000)

			return undefined
		})
	}

	useEffect(() => {
		if (localStorage) {
		}
	}, [])

	return <div onClick={handleClick}>{children}</div>
}
