import {useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'

function incrementProgress(progress: number) {
	return Math.min(progress + Math.round(Math.random() * 30), 100)
}

export function useDemoInstallProgress() {
	const [state, setState] = useState<'initial' | 'installing' | 'ready'>('initial')
	const [progress, setProgress] = useState(0)

	useEffect(() => {
		if (state === 'installing') {
			const interval = setInterval(() => setProgress(incrementProgress), Math.round(Math.random() * 500))

			if (progress == 100) {
				// Wait after install so you can see the 100%
				setTimeout(() => {
					setState('ready')
					setProgress(100)
					clearInterval(interval)
				}, 500)
			}

			return () => clearInterval(interval)
		}
	}, [state, progress])

	return {
		state,
		progress,
		install() {
			setState('installing')
		},
	}
}

export function useDemoMigrateProgress({onSuccess, onFail}: {onSuccess: () => void; onFail: () => void}) {
	const navigate = useNavigate()
	const [progress, setProgress] = useState(0)

	useEffect(() => {
		const interval = setInterval(() => setProgress(incrementProgress), Math.round(Math.random() * 500))

		if (progress == 100) {
			// Wait after install so you can see the 100%
			setTimeout(() => {
				setProgress(100)

				const didFail = Math.random() > 0.5
				if (didFail) {
					onFail()
					// navigate('/migrate/failed')
				} else {
					onSuccess()
					// navigate('/migrate/success')
				}

				clearInterval(interval)
			}, 500)
		}

		return () => clearInterval(interval)
		// Don't mind onSuccess and onFail, they're just for demo purposes
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [progress, navigate])

	return {
		progress,
	}
}
