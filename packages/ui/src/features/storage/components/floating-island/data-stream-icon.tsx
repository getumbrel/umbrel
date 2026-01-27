// Animated icons for RAID progress in floating island.
//
// DataStreamIcon: SSD-shaped icon with flickering squares (for expanded view)
// DataStreamIconMini: Circular grid of flickering squares (for minimized view)

import {useEffect, useState} from 'react'

// --- DataStreamIcon ---
// SSD-shaped icon with flickering squares and M.2 connector bars.

interface DataStreamIconProps {
	size?: number
	isActive?: boolean
}

export function DataStreamIcon({size = 32, isActive = true}: DataStreamIconProps) {
	const [activeCells, setActiveCells] = useState<Set<number>>(new Set())

	const gridCols = 5
	const gridRows = 10

	useEffect(() => {
		if (!isActive) {
			setActiveCells(new Set())
			return
		}

		const updateInterval = 90
		const minActive = 2
		const maxActive = 6
		const persistChance = 0.5

		const interval = setInterval(() => {
			setActiveCells((prev) => {
				const next = new Set<number>()
				const numActive = Math.floor(Math.random() * (maxActive - minActive + 1)) + minActive

				for (let i = 0; i < numActive; i++) {
					const cellIndex = Math.floor(Math.random() * gridCols * gridRows)
					next.add(cellIndex)
				}

				prev.forEach((cell) => {
					if (Math.random() > persistChance) {
						next.add(cell)
					}
				})

				return next
			})
		}, updateInterval)

		return () => clearInterval(interval)
	}, [isActive])

	const width = size
	const height = size * 2.5
	const borderRadius = 3
	const teethHeight = 4

	const gridPadding = 4
	const gridTop = teethHeight + 8
	const gridHeight = height - gridTop - gridPadding
	const gridWidth = width - gridPadding * 2
	const cellWidth = gridWidth / gridCols
	const cellHeight = gridHeight / gridRows
	const gapSize = 1

	const cells = []
	for (let row = 0; row < gridRows; row++) {
		for (let col = 0; col < gridCols; col++) {
			const index = row * gridCols + col
			const isActiveCell = activeCells.has(index)

			const x = gridPadding + col * cellWidth + gapSize / 2
			const y = gridTop + row * cellHeight + gapSize / 2
			const actualWidth = cellWidth - gapSize
			const actualHeight = cellHeight - gapSize

			cells.push(
				<div
					key={index}
					className='absolute bg-brand transition-all duration-75'
					style={{
						left: x,
						top: y,
						width: actualWidth,
						height: actualHeight,
						borderRadius: 1,
						opacity: isActiveCell ? 1 : 0.3,
						boxShadow: isActiveCell ? '0 0 4px hsl(var(--color-brand)), 0 0 6px hsl(var(--color-brand) / 0.5)' : 'none',
					}}
				/>,
			)
		}
	}

	// Connector bar styling - M.2 diagram style
	const connectorColor = 'rgba(255, 255, 255, 0.15)'
	const connectorHeight = 2
	const connectorTop = teethHeight
	const notchGap = 2
	const notchPosition = width * 0.7
	const leftBarWidth = notchPosition - 2
	const rightBarWidth = width - notchPosition - notchGap - 2

	return (
		<div className='relative' style={{width, height}}>
			{/* SSD body */}
			<div
				className='absolute bg-white/10'
				style={{
					top: teethHeight + connectorHeight,
					left: 0,
					right: 0,
					bottom: 0,
					borderRadius,
				}}
			/>

			{/* Connector bar - left section */}
			<div
				className='absolute'
				style={{
					left: 2,
					top: connectorTop,
					width: leftBarWidth,
					height: connectorHeight,
					backgroundColor: connectorColor,
					borderRadius: '1px 1px 0 0',
				}}
			/>

			{/* Connector bar - right section */}
			<div
				className='absolute'
				style={{
					left: notchPosition + notchGap,
					top: connectorTop,
					width: rightBarWidth,
					height: connectorHeight,
					backgroundColor: connectorColor,
					borderRadius: '1px 1px 0 0',
				}}
			/>

			{/* Flickering grid cells */}
			{cells}
		</div>
	)
}

// --- DataStreamIconMini ---
// Circular grid of flickering squares for minimized island view.

interface DataStreamIconMiniProps {
	size?: number
	isActive?: boolean
}

export function DataStreamIconMini({size = 20, isActive = true}: DataStreamIconMiniProps) {
	const [activeCells, setActiveCells] = useState<Set<number>>(new Set())

	const gridSize = 5
	const cellSize = size / gridSize
	const gapSize = 1

	useEffect(() => {
		if (!isActive) {
			setActiveCells(new Set())
			return
		}

		const interval = setInterval(() => {
			setActiveCells((prev) => {
				const next = new Set<number>()
				const numActive = Math.floor(Math.random() * 4) + 2 // 2-5 cells

				for (let i = 0; i < numActive; i++) {
					const cellIndex = Math.floor(Math.random() * gridSize * gridSize)
					next.add(cellIndex)
				}

				prev.forEach((cell) => {
					if (Math.random() > 0.5) {
						next.add(cell)
					}
				})

				return next
			})
		}, 60)

		return () => clearInterval(interval)
	}, [isActive])

	const cells = []
	for (let row = 0; row < gridSize; row++) {
		for (let col = 0; col < gridSize; col++) {
			const index = row * gridSize + col
			const isActiveCell = activeCells.has(index)

			const x = col * cellSize + gapSize / 2
			const y = row * cellSize + gapSize / 2
			const actualSize = cellSize - gapSize

			// Circular mask - fade out cells near edges
			const centerX = gridSize / 2 - 0.5
			const centerY = gridSize / 2 - 0.5
			const distFromCenter = Math.sqrt(Math.pow(col - centerX, 2) + Math.pow(row - centerY, 2))
			const maxDist = gridSize / 2
			const opacity = Math.max(0, 1 - distFromCenter / maxDist)

			if (opacity < 0.2) continue

			cells.push(
				<div
					key={index}
					className='absolute bg-brand transition-all duration-75'
					style={{
						left: x,
						top: y,
						width: actualSize,
						height: actualSize,
						borderRadius: 1,
						opacity: isActiveCell ? opacity : opacity * 0.3,
						boxShadow: isActiveCell ? '0 0 6px hsl(var(--color-brand)), 0 0 8px hsl(var(--color-brand) / 0.5)' : 'none',
					}}
				/>,
			)
		}
	}

	return (
		<div className='relative' style={{width: size, height: size}}>
			{isActive && (
				<div
					className='absolute inset-0 rounded-full'
					style={{
						background: 'radial-gradient(circle, hsl(var(--color-brand) / 0.2) 0%, transparent 70%)',
					}}
				/>
			)}
			<div className='absolute inset-0'>{cells}</div>
		</div>
	)
}
