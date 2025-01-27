import {motion} from 'framer-motion'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'

const Bar = React.memo(({height}: {height: number}) => (
	<motion.div
		className='col-span-1 mx-auto my-auto h-6 w-[2px] rounded-full bg-brand'
		animate={{height: Math.min(24, Math.max(2, height * 40))}}
		transition={{duration: 0.05}}
	/>
))
Bar.displayName = 'Bar'

// Pre-calculate frequency ranges for better performance
const RANGES = [
	[0, 200], // Deep bass (reduced range, focused on kick)
	[250, 500], // Low-mids (vocals, drums)
	[500, 2000], // Mids (vocals, guitars)
	[2000, 4000], // Upper-mids (vocals, cymbals)
	[4000, 6000], // Presence (hi-hats, effects)
	[6000, 16000], // Air/Brilliance (cymbals, effects)
] as const

// Memoized frequency weight calculation
const getFrequencyWeights = (binSize: number, frequencyBinCount: number) => {
	const weights = RANGES.map(([start, end]) => {
		const startBin = Math.floor(start / binSize)
		const endBin = Math.min(Math.floor(end / binSize), frequencyBinCount - 1)
		const binWeights = new Float32Array(endBin - startBin + 1)

		for (let i = 0; i < binWeights.length; i++) {
			binWeights[i] = Math.log2(2 + i / binWeights.length)
		}

		return {startBin, endBin, weights: binWeights}
	})

	return weights
}

interface MusicEqualizerProps {
	isPlaying: boolean
	analyserNode?: AnalyserNode
}

const MusicEqualizerComponent = ({isPlaying, analyserNode}: MusicEqualizerProps) => {
	const [levels, setLevels] = useState<number[]>(Array(6).fill(0))
	const frameRef = useRef<number>()
	const prevLevels = useRef<number[]>(Array(6).fill(0))
	const dataRef = useRef<Uint8Array>()

	// Memoize frequency weights calculation
	const frequencyWeights = useMemo(() => {
		if (!analyserNode) return null
		const binSize = analyserNode.context.sampleRate / (2 * analyserNode.frequencyBinCount)
		return getFrequencyWeights(binSize, analyserNode.frequencyBinCount)
	}, [analyserNode])

	// Memoize the level calculation function
	const calculateLevels = useCallback((data: Uint8Array, weights: ReturnType<typeof getFrequencyWeights>) => {
		return weights.map(({startBin, endBin, weights: binWeights}, index) => {
			let sum = 0
			let count = 0

			// Ensure we don't exceed the data array bounds
			const binCount = Math.min(endBin - startBin + 1, data.length - startBin)

			// Use a more efficient loop without creating intermediate variables
			for (let i = 0; i < binCount; i++) {
				const value = data[startBin + i] / 255
				const weight = binWeights[i]

				// Apply frequency-specific scaling
				const scaledValue =
					index <= 1 ? Math.pow(value, index === 0 ? 3.5 : 2.0) * (index === 0 ? 0.7 : 1.0) : Math.pow(value, 1.5)

				sum += scaledValue * weight
				count += weight
			}

			const instantLevel = Math.pow(sum / count, 1.2)
			const smoothingFactor = index === 0 ? 0.5 : index === 1 ? 0.7 : 0.8

			// Use the previous level for smoother transitions
			const prevLevel = prevLevels.current[index] || 0
			const smoothedLevel = instantLevel * smoothingFactor + prevLevel * (1 - smoothingFactor)
			prevLevels.current[index] = smoothedLevel

			return smoothedLevel
		})
	}, [])

	useEffect(() => {
		if (!analyserNode || !isPlaying || !frequencyWeights) {
			if (frameRef.current) {
				cancelAnimationFrame(frameRef.current)
				frameRef.current = undefined
			}
			// Only reset levels if we're stopping playback
			if (!isPlaying) {
				setLevels(Array(6).fill(0))
				prevLevels.current = Array(6).fill(0)
			}
			return
		}

		// Create data array only once
		if (!dataRef.current) {
			dataRef.current = new Uint8Array(analyserNode.frequencyBinCount)
		}

		let lastFrameTime = performance.now()
		const minFrameInterval = 1000 / 30 // Cap at 30 FPS

		const update = () => {
			const currentTime = performance.now()
			const deltaTime = currentTime - lastFrameTime

			// Throttle updates to maintain consistent frame rate
			if (deltaTime >= minFrameInterval) {
				analyserNode.getByteFrequencyData(dataRef.current!)
				const newLevels = calculateLevels(dataRef.current!, frequencyWeights)
				setLevels(newLevels)
				lastFrameTime = currentTime
			}

			frameRef.current = requestAnimationFrame(update)
		}

		update()

		return () => {
			if (frameRef.current) {
				cancelAnimationFrame(frameRef.current)
			}
		}
	}, [analyserNode, isPlaying, frequencyWeights, calculateLevels])

	return (
		<div className='grid h-full grid-cols-6 justify-center gap-[1px] bg-transparent'>
			{levels.map((height, i) => (
				<Bar key={i} height={height} />
			))}
		</div>
	)
}

MusicEqualizerComponent.displayName = 'MusicEqualizer'

// Memoize the entire component to prevent unnecessary re-renders
export const MusicEqualizer = React.memo(MusicEqualizerComponent)
