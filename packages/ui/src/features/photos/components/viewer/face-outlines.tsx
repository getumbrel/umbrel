import type {FaceBox} from '@/features/photos/components/people/avatar-crop'
import {cn} from '@/lib/utils'

export type PersonInPicture = {id: string; name?: string; face: FaceBox}

// Which faces are pointed at: one person's (a hovered chip), everyone's (the
// info panel's toggle), or nobody's
export type FaceFocus = {personId: string} | 'all' | null

// The detector's box hugs brow to chin; the outline stands off it a little
// so it frames the face instead of cutting through the hair. Kept inside the
// picture: an outline over the edge would be clipped to a broken corner.
const STAND_OFF = 0.14

export function outlineBox(face: FaceBox): FaceBox {
	const padX = face.width * STAND_OFF
	const padY = face.height * STAND_OFF
	const left = Math.max(0, face.x - padX)
	const top = Math.max(0, face.y - padY)
	const right = Math.min(1, face.x + face.width + padX)
	const bottom = Math.min(1, face.y + face.height + padY)
	return {x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top)}
}

// Faces outlined on the stage. A child of the picture's own box — which is
// exactly the displayed picture, never letterboxed (the stage fits the box
// to the picture's shape) — so fractions of the picture are percentages
// here, and whatever moves the picture (the flight, a drag, a zoom) moves
// the outlines with it. Every outline is always mounted and only its opacity
// and scale change, so pointing from one face to the next is a cross-fade:
// the frame settles onto a face from slightly larger, as a camera's does.
export function FaceOutlines({people, focus}: {people: readonly PersonInPicture[]; focus: FaceFocus}) {
	return (
		<div aria-hidden className='pointer-events-none absolute inset-0 z-[1]'>
			{people.map((person) => {
				const box = outlineBox(person.face)
				const shown = focus === 'all' || (focus !== null && focus.personId === person.id)
				return (
					<div
						key={person.id}
						className={cn(
							'absolute transition-[opacity,scale] duration-200 ease-out motion-reduce:transition-none',
							shown ? 'scale-100 opacity-100' : 'scale-110 opacity-0',
						)}
						style={{
							left: `${box.x * 100}%`,
							top: `${box.y * 100}%`,
							width: `${box.width * 100}%`,
							height: `${box.height * 100}%`,
						}}
					>
						{/* Light on any photograph: a white line with a dark hairline either side of it */}
						<span className='absolute inset-0 rounded-[26%] border-[1.5px] border-white/90 shadow-[0_0_0_0.5px_rgb(0_0_0/0.35),inset_0_0_0_0.5px_rgb(0_0_0/0.35),0_2px_12px_rgb(0_0_0/0.25)]' />
						{person.name && (
							<span className='absolute top-full left-1/2 mt-1.5 max-w-40 -translate-x-1/2 truncate rounded-full bg-black/55 px-2 py-0.5 text-11 font-medium whitespace-nowrap text-white backdrop-blur-sm'>
								{person.name}
							</span>
						)}
					</div>
				)
			})}
		</div>
	)
}
