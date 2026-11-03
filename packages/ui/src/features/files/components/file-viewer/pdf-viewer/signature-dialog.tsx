import {useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {dialogFooterClass} from '@/components/ui/shared/dialog'
import type {Drawing} from '@/features/files/components/file-viewer/pdf-viewer/markup'

// In the pad's pixels; pdf.js scales the signature, and the pen with it, to
// the page
const THICKNESS = 3

// A pen on paper: every stroke is kept as the points the pointer passed
// through, and drawn as the same curve pdf.js will lay through them
export function SignatureDialog({onAdd, onCancel}: {onAdd: (drawing: Drawing) => void; onCancel: () => void}) {
	const {t} = useTranslation()
	const padRef = useRef<SVGSVGElement>(null)
	const [strokes, setStrokes] = useState<number[][]>([])
	const drawing = useRef<number | null>(null)

	const pointAt = (event: {clientX: number; clientY: number}) => {
		const rect = padRef.current!.getBoundingClientRect()
		return [Math.round(event.clientX - rect.left), Math.round(event.clientY - rect.top)]
	}

	return (
		<Dialog open onOpenChange={(open) => !open && onCancel()}>
			<DialogContent className='sm:max-w-[560px]'>
				<DialogHeader>
					<DialogTitle>{t('files-pdf.signature-title')}</DialogTitle>
					<DialogDescription>{t('files-pdf.signature-detail')}</DialogDescription>
				</DialogHeader>
				<div className='relative h-48 overflow-hidden rounded-12 bg-white shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)]'>
					<div className='pointer-events-none absolute inset-x-8 bottom-12 border-b border-dashed border-black/20' />
					{strokes.length === 0 && (
						<p className='pointer-events-none absolute inset-x-0 bottom-14 text-center text-13 text-black/35'>
							{t('files-pdf.signature-placeholder')}
						</p>
					)}
					<svg
						ref={padRef}
						role='img'
						aria-label={t('files-pdf.signature-pad')}
						className='absolute inset-0 size-full cursor-crosshair touch-none'
						onPointerDown={(event) => {
							if (drawing.current !== null || event.button !== 0) return
							event.currentTarget.setPointerCapture(event.pointerId)
							drawing.current = event.pointerId
							setStrokes((strokes) => [...strokes, pointAt(event)])
						}}
						onPointerMove={(event) => {
							if (drawing.current !== event.pointerId) return
							const {width, height} = event.currentTarget.getBoundingClientRect()
							// Fast pens report more points than they fire events for
							const points = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]
							setStrokes((strokes) => {
								const stroke = [...strokes.at(-1)!]
								for (const point of points) {
									const [x, y] = pointAt(point)
									const moved = x !== stroke.at(-2) || y !== stroke.at(-1)
									if (moved && x >= 0 && y >= 0 && x <= width && y <= height) stroke.push(x, y)
								}
								return [...strokes.slice(0, -1), stroke]
							})
						}}
						onPointerUp={() => (drawing.current = null)}
						onPointerCancel={() => (drawing.current = null)}
					>
						{strokes.map((points, index) => (
							<path
								key={index}
								d={pathThrough(points)}
								fill='none'
								stroke='#111'
								strokeWidth={THICKNESS}
								strokeLinecap='round'
								strokeLinejoin='round'
							/>
						))}
					</svg>
				</div>
				{/* Cancel and Add on the trailing edge like every dialog, Clear on its own at the leading edge */}
				<DialogFooter className='md:justify-between'>
					<div className={dialogFooterClass}>
						<Button
							size='dialog'
							variant='primary'
							disabled={strokes.length === 0}
							onClick={() => {
								const {width, height} = padRef.current!.getBoundingClientRect()
								onAdd({curves: strokes.map((points) => ({points})), thickness: THICKNESS, width, height})
							}}
						>
							{t('files-pdf.signature-add')}
						</Button>
						<Button size='dialog' onClick={onCancel}>
							{t('cancel')}
						</Button>
					</div>
					<Button size='dialog' disabled={strokes.length === 0} onClick={() => setStrokes([])}>
						{t('files-pdf.signature-clear')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

// Each segment ends halfway to the next point, curving through the one
// between — pdf.js's own ink smoothing, so what's added is what was drawn
function pathThrough(points: number[]) {
	let path = `M${points[0]} ${points[1]}`
	if (points.length === 2) return `${path}L${points[0]} ${points[1]}`
	for (let i = 2; i < points.length; i += 2) {
		const [x, y] = [points[i], points[i + 1]]
		if (i === 2) {
			path += `L${x} ${y}`
			continue
		}
		const [x1, y1, x2, y2] = points.slice(i - 4, i)
		path += `C${(x1 + 5 * x2) / 6} ${(y1 + 5 * y2) / 6} ${(5 * x2 + x) / 6} ${(5 * y2 + y) / 6} ${(x2 + x) / 2} ${(y2 + y) / 2}`
	}
	return path
}
