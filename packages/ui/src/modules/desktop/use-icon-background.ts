import {useEffect, useState} from 'react'

export function useIconBackground(iconSrc: string) {
	const [backgroundColor, setBackgroundColor] = useState<string | null>(null)

	useEffect(() => {
		if (!iconSrc) {
			setBackgroundColor(null)
			return
		}

		const img = new Image()
		img.crossOrigin = 'anonymous'
		
		img.onload = () => {
			try {
				const canvas = document.createElement('canvas')
				const ctx = canvas.getContext('2d')
				if (!ctx) return

				canvas.width = img.width
				canvas.height = img.height
				ctx.drawImage(img, 0, 0)

				// Sample pixels from the edges
				const edgePixels: {r: number; g: number; b: number; a: number}[] = []
				
				// Sample top edge
				for (let x = 0; x < img.width; x += Math.max(1, Math.floor(img.width / 20))) {
					const pixel = ctx.getImageData(x, 0, 1, 1).data
					edgePixels.push({r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3]})
				}
				
				// Sample bottom edge
				for (let x = 0; x < img.width; x += Math.max(1, Math.floor(img.width / 20))) {
					const pixel = ctx.getImageData(x, img.height - 1, 1, 1).data
					edgePixels.push({r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3]})
				}
				
				// Sample left edge
				for (let y = 0; y < img.height; y += Math.max(1, Math.floor(img.height / 20))) {
					const pixel = ctx.getImageData(0, y, 1, 1).data
					edgePixels.push({r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3]})
				}
				
				// Sample right edge
				for (let y = 0; y < img.height; y += Math.max(1, Math.floor(img.height / 20))) {
					const pixel = ctx.getImageData(img.width - 1, y, 1, 1).data
					edgePixels.push({r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3]})
				}

				// Check if all edges are the same color (within tolerance)
				const firstPixel = edgePixels[0]
				const tolerance = 10 // Allow small variations
				
				const allSame = edgePixels.every(
					(p) =>
						Math.abs(p.r - firstPixel.r) <= tolerance &&
						Math.abs(p.g - firstPixel.g) <= tolerance &&
						Math.abs(p.b - firstPixel.b) <= tolerance &&
						Math.abs(p.a - firstPixel.a) <= tolerance,
				)

				if (allSame) {
					// If transparent edges, use white
					if (firstPixel.a < 128) {
						setBackgroundColor('rgb(255, 255, 255)')
					} else {
						// Use the detected edge color
						setBackgroundColor(`rgb(${firstPixel.r}, ${firstPixel.g}, ${firstPixel.b})`)
					}
				} else {
					// Edges are different colors, don't add background
					setBackgroundColor(null)
				}
			} catch (error) {
				// CORS or other error, don't add background
				setBackgroundColor(null)
			}
		}

		img.onerror = () => {
			setBackgroundColor(null)
		}

		img.src = iconSrc
	}, [iconSrc])

	return backgroundColor
}
