import {memo, useCallback, useEffect, useMemo, useRef} from 'react'

interface LaserEngravingProps {
	text?: string
	fontSize?: number
	width?: number
	height?: number
	backgroundColor?: string
	engravingColor?: string
	speed?: number
	delay?: number
	className?: string
}

interface Point {
	x: number
	y: number
}

type AnimationPhase = 'scanning' | 'engraving' | 'touching-up' | 'final-scanning'

class SmokeParticle {
	private x: number
	private y: number
	private age: number
	private maxAge: number
	private velocityY: number
	private velocityX: number
	private size: number
	private turbulence: number
	private alpha: number

	constructor(x: number, y: number) {
		this.x = x
		this.y = y
		this.age = 0
		this.maxAge = 100 + Math.random() * 20
		this.velocityY = -0.8 - Math.random() * 0.3
		this.velocityX = (Math.random() - 0.5) * 0.6
		this.size = 2 + Math.random() * 2
		this.turbulence = Math.random() * 0.08
		this.alpha = 0.15 + Math.random() * 0.1
	}

	update(): boolean {
		this.age++
		this.velocityX += (Math.random() - 0.5) * this.turbulence
		this.velocityY *= 0.99
		this.x += this.velocityX
		this.y += this.velocityY
		this.size += 0.05
		return this.age < this.maxAge
	}

	draw(ctx: CanvasRenderingContext2D): void {
		const lifeProgress = this.age / this.maxAge
		const alpha = (1 - lifeProgress) * this.alpha
		const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size)
		gradient.addColorStop(0, `rgba(175, 175, 175, ${alpha})`)
		gradient.addColorStop(0.5, `rgba(150, 150, 150, ${alpha * 0.5})`)
		gradient.addColorStop(1, 'rgba(100, 100, 100, 0)')
		ctx.fillStyle = gradient
		ctx.beginPath()
		ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)
		ctx.fill()
	}
}

export const LaserEngraving: React.FC<LaserEngravingProps> = memo(
	({
		text = '',
		fontSize = 24,
		width = 335,
		height = 335,
		backgroundColor = '#111',
		engravingColor = '#222',
		speed = 12,
		delay = 0,
		className = '',
	}) => {
		const canvasRef = useRef<HTMLCanvasElement | null>(null)

		// Memoize canvas style and font string
		const canvasStyle = useMemo(
			() => ({
				background: backgroundColor,
				maxWidth: '100%',
			}),
			[backgroundColor],
		)

		const fontString = useMemo(
			() =>
				`${fontSize}px "Inter var", ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"`,
			[fontSize],
		)

		// Memoize points calculation
		const points = useMemo(() => {
			const tempCanvas = document.createElement('canvas')
			const tempCtx = tempCanvas.getContext('2d')
			if (!tempCtx || !text) return [] // Early return if no context or text

			tempCanvas.width = width
			tempCanvas.height = height

			tempCtx.font = fontString // Use memoized font string
			const textMetrics = tempCtx.measureText(text)
			const textX = (width - textMetrics.width) / 2
			const textY = height / 2

			tempCtx.fillStyle = 'white'
			tempCtx.fillText(text, textX, textY)
			const imageData = tempCtx.getImageData(0, 0, width, height)
			const pixels = imageData.data

			const textPoints: Point[] = []
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					const i = (y * width + x) * 4
					if (pixels[i] > 0) {
						textPoints.push({x, y})
					}
				}
			}

			return textPoints.sort((a, b) => {
				if (a.x === b.x) return a.y - b.y
				return a.x - b.x
			})
		}, [text, fontString, width, height])

		// Memoize drawing functions
		const drawFunctions = useMemo(
			() => ({
				drawLaser(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number): void {
					// Draw outer red glow (increased from 6 to 8)
					ctx.beginPath()
					const outerGradient = ctx.createRadialGradient(x, y, 0, x, y, 10)
					outerGradient.addColorStop(0, 'rgba(255, 0, 0, 0.8)')
					outerGradient.addColorStop(0.5, 'rgba(255, 0, 0, 0.4)')
					outerGradient.addColorStop(1, 'rgba(255, 0, 0, 0)')
					ctx.fillStyle = outerGradient
					ctx.arc(x, y, 10, 0, Math.PI * 2)
					ctx.fill()

					// Draw bright white center (increased from 2 to 3)
					ctx.beginPath()
					const innerGradient = ctx.createRadialGradient(x, y, 0, x, y, 3)
					innerGradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
					innerGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.8)')
					innerGradient.addColorStop(1, 'rgba(255, 200, 200, 0)')
					ctx.fillStyle = innerGradient
					ctx.arc(x, y, 3, 0, Math.PI * 2)
					ctx.fill()
				},

				createSmoke(x: number, y: number): SmokeParticle[] {
					const particles: SmokeParticle[] = []
					for (let i = 0; i < 3; i++) {
						const offsetX = (Math.random() - 0.5) * 3
						const offsetY = (Math.random() - 0.5) * 3
						particles.push(new SmokeParticle(x + offsetX, y + offsetY))
					}
					return particles
				},

				// Add new function for drawing laser line
				drawLaserLine(
					ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
					startX: number,
					startY: number,
					endX: number,
					endY: number,
				): void {
					// Draw the entire line segment with bright red
					ctx.beginPath()
					ctx.strokeStyle = 'rgb(255, 0, 0)'
					ctx.lineWidth = 2
					ctx.shadowColor = 'rgba(255, 0, 0, 0.8)'
					ctx.shadowBlur = 4
					ctx.moveTo(startX, startY)
					ctx.lineTo(endX, endY)
					ctx.stroke()

					// Add a brighter core to the line
					ctx.beginPath()
					ctx.strokeStyle = 'rgba(255, 100, 100, 0.9)'
					ctx.lineWidth = 1
					ctx.moveTo(startX, startY)
					ctx.lineTo(endX, endY)
					ctx.stroke()

					ctx.shadowBlur = 0
				},
			}),
			[],
		)

		// Add new memoized function for bounding box coordinates
		const boundingBox = useMemo(() => {
			const tempCanvas = document.createElement('canvas')
			const tempCtx = tempCanvas.getContext('2d')
			if (!tempCtx) return {x: 0, y: 0, width: 0, height: 0}

			tempCtx.font = `${fontSize}px "Inter var", ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"`
			const metrics = tempCtx.measureText(text)
			const textX = (width - metrics.width) / 2
			const textY = height / 2

			return {
				x: textX - 2,
				y: textY - fontSize + 1,
				width: metrics.width + 4,
				height: fontSize + 4,
			}
		}, [text, fontSize, width, height])

		// Optimize particle batch processing with TypedArrays
		const updateAndDrawParticles = useCallback(
			(
				particles: SmokeParticle[],
				ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
			): SmokeParticle[] => {
				const aliveParticles: SmokeParticle[] = []

				// Process all particles
				particles.forEach((particle) => {
					if (particle.update()) {
						particle.draw(ctx as CanvasRenderingContext2D)
						aliveParticles.push(particle)
					}
				})

				return aliveParticles
			},
			[],
		)

		// Optimize engraved points handling with Set and TypedArray
		const drawEngravedPoints = useCallback(
			(
				ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
				points: Set<string>,
				color1: string,
				color2: string,
			) => {
				const pointsArray = Array.from(points)
				const buffer = new Float32Array(pointsArray.length * 3) // x, y, pass

				// Batch process points into TypedArray
				pointsArray.forEach((point, index) => {
					const [x, y, pass] = point.split(',').map(Number)
					const offset = index * 3
					buffer[offset] = x
					buffer[offset + 1] = y
					buffer[offset + 2] = pass
				})

				// Draw points in batches
				ctx.save()
				for (let i = 0; i < buffer.length; i += 3) {
					ctx.fillStyle = buffer[i + 2] === 2 ? color1 : color2
					ctx.fillRect(buffer[i], buffer[i + 1], 1, 1)
				}
				ctx.restore()
			},
			[],
		)

		useEffect(() => {
			const canvas = canvasRef.current
			if (!canvas || points.length === 0) return

			const mainCtx = canvas.getContext('2d')
			if (!mainCtx) return

			const offscreen = new OffscreenCanvas(width, height)
			const offscreenCtx = offscreen.getContext('2d', {
				alpha: true,
				desynchronized: true,
			})

			if (!offscreenCtx) return

			let smokeParticles: SmokeParticle[] = []
			const engravedPoints = new Set<string>()
			let lastFrameTime = performance.now()
			let animationFrameId: number

			// Move generateScanPoints inside useEffect
			const generateScanPoints = (box: typeof boundingBox): Point[] => {
				const points: Point[] = []
				const numPointsPerSide = 20

				// Left edge (top to bottom)
				for (let i = 0; i <= numPointsPerSide; i++) {
					points.push({
						x: box.x,
						y: box.y + (box.height * i) / numPointsPerSide,
					})
				}

				// Bottom edge (left to right)
				for (let i = 0; i <= numPointsPerSide; i++) {
					points.push({
						x: box.x + (box.width * i) / numPointsPerSide,
						y: box.y + box.height,
					})
				}

				// Right edge (bottom to top)
				for (let i = 0; i <= numPointsPerSide; i++) {
					points.push({
						x: box.x + box.width,
						y: box.y + box.height - (box.height * i) / numPointsPerSide,
					})
				}

				// Top edge (right to left)
				for (let i = 0; i <= numPointsPerSide; i++) {
					points.push({
						x: box.x + box.width - (box.width * i) / numPointsPerSide,
						y: box.y,
					})
				}

				return points
			}

			const scanPoints = generateScanPoints(boundingBox)

			let phase: AnimationPhase = 'scanning'
			let scanCount = 0
			let scanProgress = 0
			let currentPoint = 0
			let direction: 'ltr' | 'rtl' = 'ltr'
			let passes = 0
			const maxPasses = 2
			let finalScanCount = 0
			let touchUpStartTime = 0
			let touchUpPoints: Point[] = []
			const TOUCH_UP_DURATION = 1500 // 1.5 seconds in milliseconds

			const generateTouchUpPoints = () => {
				// Get all half-engraved points
				const halfEngravedPoints = Array.from(engravedPoints)
					.filter((point) => point.split(',')[2] === '1')
					.map((point) => {
						const [x, y] = point.split(',').map(Number)
						return {x, y}
					})

				// Randomly select 30 points for touch-up
				const selectedPoints: Point[] = []
				while (selectedPoints.length < 30 && halfEngravedPoints.length > 0) {
					const randomIndex = Math.floor(Math.random() * halfEngravedPoints.length)
					selectedPoints.push(halfEngravedPoints[randomIndex])
					halfEngravedPoints.splice(randomIndex, 1)
				}

				return selectedPoints
			}

			function animate(currentTime: number): void {
				if (currentTime - lastFrameTime < 16.67) {
					animationFrameId = requestAnimationFrame(animate)
					return
				}
				lastFrameTime = currentTime

				offscreenCtx!.clearRect(0, 0, width, height)

				if (phase === 'scanning') {
					scanProgress += 0.1

					// Clear the canvas for this frame
					offscreenCtx!.clearRect(0, 0, width, height)

					// Draw engraved text if it exists
					if (engravedPoints.size > 0) {
						drawEngravedPoints(
							offscreenCtx!,
							engravedPoints,
							engravingColor,
							passes === maxPasses ? engravingColor : `${engravingColor}80`,
						)
					}

					// Update and draw smoke particles
					smokeParticles = updateAndDrawParticles(smokeParticles, offscreenCtx as any)

					// Only draw scanning animation if not complete
					if (!(passes === maxPasses && finalScanCount >= 4)) {
						// Calculate start and end points for the visible line segment
						const totalPoints = scanPoints.length
						const wrappedProgress = (scanCount + scanProgress) % 5
						const currentPoint = Math.floor(wrappedProgress * totalPoints) % totalPoints
						const lineLength = totalPoints / 4

						// Calculate start point with wrapping
						const startPoint = (currentPoint - lineLength + totalPoints) % totalPoints
						let endPoint = currentPoint

						// Handle case where line wraps around the end
						if (startPoint > endPoint) {
							endPoint += totalPoints
						}

						// Draw the laser line
						offscreenCtx!.beginPath()
						offscreenCtx!.strokeStyle = 'rgb(255, 0, 0)'
						offscreenCtx!.lineWidth = 2
						offscreenCtx!.shadowColor = 'rgba(255, 0, 0, 0.8)'
						offscreenCtx!.shadowBlur = 4

						// Draw the path (handling wrap-around)
						offscreenCtx!.moveTo(scanPoints[startPoint % totalPoints].x, scanPoints[startPoint % totalPoints].y)
						for (let i = startPoint + 1; i <= endPoint; i++) {
							const idx = i % totalPoints
							offscreenCtx!.lineTo(scanPoints[idx].x, scanPoints[idx].y)
						}

						offscreenCtx!.stroke()

						// Add a brighter core line
						offscreenCtx!.beginPath()
						offscreenCtx!.strokeStyle = 'rgba(255, 100, 100, 0.9)'
						offscreenCtx!.lineWidth = 1
						offscreenCtx!.shadowBlur = 0

						offscreenCtx!.moveTo(scanPoints[startPoint % totalPoints].x, scanPoints[startPoint % totalPoints].y)
						for (let i = startPoint + 1; i <= endPoint; i++) {
							const idx = i % totalPoints
							offscreenCtx!.lineTo(scanPoints[idx].x, scanPoints[idx].y)
						}

						offscreenCtx!.stroke()
					}

					// Update scan count after drawing
					if (scanProgress >= 1) {
						scanCount++
						scanProgress = 0

						if (scanCount >= 8) {
							if (passes === maxPasses && finalScanCount >= 4) {
								// Draw final state and stop animation
								mainCtx!.clearRect(0, 0, width, height)
								drawEngravedPoints(mainCtx!, engravedPoints, engravingColor, engravingColor)
								return
							} else if (passes === maxPasses) {
								finalScanCount++
							} else {
								phase = 'engraving'
								currentPoint = 0
								direction = 'ltr'
							}
						}
					}
				} else if (phase === 'engraving') {
					// Draw existing engraved points with appropriate opacity
					// Points from first pass should be half opacity, points from second pass should be full opacity
					const halfOpacityPoints = new Set(
						Array.from(engravedPoints)
							.filter((point) => point.split(',')[2] === '1')
							.map((point) => point),
					)
					const fullOpacityPoints = new Set(
						Array.from(engravedPoints)
							.filter((point) => point.split(',')[2] === '2')
							.map((point) => point),
					)

					// Draw half opacity points first
					if (halfOpacityPoints.size > 0) {
						drawEngravedPoints(offscreenCtx!, halfOpacityPoints, engravingColor, `${engravingColor}80`)
					}
					// Draw full opacity points on top
					if (fullOpacityPoints.size > 0) {
						drawEngravedPoints(offscreenCtx!, fullOpacityPoints, engravingColor, engravingColor)
					}

					// Update smoke particles
					smokeParticles = updateAndDrawParticles(smokeParticles, offscreenCtx as any)

					// Engrave new points with pass number
					for (let i = 0; i < speed; i++) {
						if (direction === 'ltr' && currentPoint < points.length) {
							const point = points[currentPoint]
							engravedPoints.add(`${point.x},${point.y},1`) // First pass
							currentPoint++
						} else if (direction === 'rtl' && currentPoint >= 0) {
							const point = points[currentPoint]
							engravedPoints.add(`${point.x},${point.y},2`) // Second pass
							currentPoint--
						}
					}

					// Draw laser and smoke at current position
					if ((direction === 'ltr' && currentPoint < points.length) || (direction === 'rtl' && currentPoint >= 0)) {
						const currentPos = points[currentPoint]
						drawFunctions.drawLaser(offscreenCtx!, currentPos.x, currentPos.y)
						smokeParticles.push(...drawFunctions.createSmoke(currentPos.x, currentPos.y))
					} else {
						// When first pass is complete (LTR), transition to touch-up
						if (direction === 'ltr') {
							phase = 'touching-up'
							touchUpStartTime = currentTime
							touchUpPoints = generateTouchUpPoints()
						} else {
							// Finished second pass (RTL)
							passes = maxPasses
							phase = 'scanning'
							scanCount = 0
							scanProgress = 0
						}
					}
				} else if (phase === 'touching-up') {
					// During touch-up, maintain half opacity
					drawEngravedPoints(offscreenCtx!, engravedPoints, engravingColor, `${engravingColor}80`)

					// Update smoke particles
					smokeParticles = updateAndDrawParticles(smokeParticles, offscreenCtx as any)

					// Calculate touch-up progress
					const touchUpElapsed = currentTime - touchUpStartTime

					if (touchUpElapsed < TOUCH_UP_DURATION) {
						// Randomly move between touch-up points
						const randomIndex = Math.floor(Math.random() * touchUpPoints.length)
						const targetPoint = touchUpPoints[randomIndex]

						// Draw laser and smoke effects
						drawFunctions.drawLaser(offscreenCtx!, targetPoint.x, targetPoint.y)
						smokeParticles.push(...drawFunctions.createSmoke(targetPoint.x, targetPoint.y))
					} else {
						// Transition to second pass
						phase = 'engraving'
						direction = 'rtl'
						currentPoint = points.length - 1
					}
				}

				// Copy offscreen canvas to main canvas
				mainCtx!.clearRect(0, 0, width, height)

				mainCtx!.drawImage(offscreen, 0, 0)

				if (phase === 'scanning' || currentPoint < points.length || smokeParticles.length > 0) {
					animationFrameId = requestAnimationFrame(animate)
				}
			}

			// Start animation after delay
			const timeoutId = setTimeout(() => {
				animate(performance.now())
			}, delay * 1000)

			return () => {
				if (animationFrameId) cancelAnimationFrame(animationFrameId)
				clearTimeout(timeoutId) // Clean up timeout
				offscreen.width = 0
				offscreen.height = 0
				smokeParticles = []
				engravedPoints.clear()
			}
		}, [
			points,
			width,
			height,
			backgroundColor,
			engravingColor,
			speed,
			delay,
			drawFunctions,
			boundingBox,
			drawEngravedPoints,
			updateAndDrawParticles,
		])

		return <canvas ref={canvasRef} width={width} height={height} style={canvasStyle} className={className} />
	},
)
