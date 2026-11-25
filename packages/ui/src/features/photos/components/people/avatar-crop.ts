// Where a person's cover photo sits inside their round avatar, so the circle
// frames the face. Pure geometry — the avatar is a CSS crop of the cover
// item's ordinary thumbnail, there is no face-sized image to ask for.

// A face's rectangle as fractions of the displayed picture, origin top left
export type FaceBox = {x: number; y: number; width: number; height: number}

// The face detector's box hugs brow to chin; a portrait wants the hair, the
// jaw and a little air, so the circle shows this many face-lengths
const PADDING = 2.1
// How far past its own pixels a crop may be stretched before it reads as
// mush. A small face in a wide photo is shown smaller in the circle, with
// more of the scene around it, rather than blown up beyond this.
const MAX_UPSCALE = 1.5

export type AvatarCrop = {
	// The whole picture's box, as percentages of the avatar's side — an <img>
	// positioned with these inside an `overflow-hidden` circle shows the crop
	left: number
	top: number
	width: number
	height: number
}

// The pixels of the rendition an avatar shows, known from the item's own
// displayed size before any of it has loaded: a thumbnail keeps the
// picture's shape with its short edge at `shortEdge`, and is never enlarged.
export function renditionSize(width: number, height: number, shortEdge: number) {
	const scale = Math.min(1, shortEdge / Math.min(width, height))
	return {width: width * scale, height: height * scale}
}

// `width`/`height` are the pixels of the picture shown (the thumbnail's, see
// renditionSize), `devicePx` how many device pixels the avatar's side covers.
// The crop is the square of the picture centred on the face — padded, never
// larger than the picture, never smaller than the pixels the avatar needs,
// and slid back inside the picture's edges when the face is near one.
export function avatarCrop(face: FaceBox, width: number, height: number, devicePx: number): AvatarCrop {
	const short = Math.min(width, height)
	const faceSide = Math.max(face.width * width, face.height * height)
	// A box with no area (a face not located) gets the centre square
	const wanted = faceSide > 0 ? faceSide * PADDING : short
	const side = Math.min(short, Math.max(wanted, devicePx / MAX_UPSCALE))
	const centerX = faceSide > 0 ? (face.x + face.width / 2) * width : width / 2
	const centerY = faceSide > 0 ? (face.y + face.height / 2) * height : height / 2
	const x = Math.min(width - side, Math.max(0, centerX - side / 2))
	const y = Math.min(height - side, Math.max(0, centerY - side / 2))
	return {
		left: (-x / side) * 100,
		top: (-y / side) * 100,
		width: (width / side) * 100,
		height: (height / side) * 100,
	}
}
