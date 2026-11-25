import {useState} from 'react'

import {useDevicePixelRatio} from '@/features/photos/components/listing/gpu'
import {tintColor} from '@/features/photos/components/listing/item-thumbnail'
import {avatarCrop, renditionSize, type FaceBox} from '@/features/photos/components/people/avatar-crop'
import {itemThumbnailUrl, type ThumbSize} from '@/features/photos/hooks/use-items'
import {cn} from '@/lib/utils'
import {useSharedAuthorizedHttpUrl} from '@/modules/auth/http-url-authorizer'

// Up to this many CSS px across, a circle is drawn from the 192 rendition (a
// thumbnail's size is its short edge): a face in a chip or a menu row needs
// no more, and a row of them should not fetch a 512 each
const SMALL_AVATAR = 64

// A person's face in a circle: their cover item's ordinary thumbnail — one
// the grid already has in the browser's cache — cropped to the face with CSS
// (see avatarCrop). Every surface that shows a person shows this.
// The crop needs the picture's shape, which the cover carries, so the face is
// framed from the first frame: the circle is the picture's own tint until
// the thumbnail arrives, and the face fades in exactly where it will stay.
export function PersonAvatar({
	person,
	size,
	fluid = false,
	className,
	style,
}: {
	// `width`/`height` are the cover item's displayed size, as an item carries them
	person: {cover: {itemId: string; face: FaceBox; width: number; height: number; tint?: number}}
	// The circle's side in px. With `fluid` the caller sizes the box (a grid
	// cell, say) and this is only how many pixels it is expected to cover.
	size: number
	fluid?: boolean
	className?: string
	style?: React.CSSProperties
}) {
	const dpr = useDevicePixelRatio()
	const {itemId, face, width, height, tint} = person.cover
	const shortEdge: ThumbSize = size <= SMALL_AVATAR ? 192 : 512
	const url = useSharedAuthorizedHttpUrl(itemThumbnailUrl(itemId, shortEdge))
	// Belongs to its URL: a changed cover starts from its tint again
	const [loadedUrl, setLoadedUrl] = useState<string>()
	// An item whose size was never read has no shape to frame a face in: its
	// picture fills the circle from the centre instead
	const rendition = width > 0 && height > 0 ? renditionSize(width, height, shortEdge) : undefined
	const crop = rendition && avatarCrop(face, rendition.width, rendition.height, size * dpr)
	return (
		<span
			className={cn(
				'relative block shrink-0 overflow-hidden rounded-full',
				tint === undefined && 'bg-white/8',
				className,
			)}
			style={{backgroundColor: tintColor(tint), ...(fluid ? {} : {width: size, height: size}), ...style}}
		>
			{url && (
				<img
					key={url}
					src={url}
					alt=''
					draggable={false}
					decoding='async'
					onLoad={() => setLoadedUrl(url)}
					className={cn(
						'absolute max-w-none transition-opacity duration-300 motion-reduce:transition-none',
						!crop && 'inset-0 size-full object-cover',
						loadedUrl === url ? 'opacity-100' : 'opacity-0',
					)}
					style={
						crop && {left: `${crop.left}%`, top: `${crop.top}%`, width: `${crop.width}%`, height: `${crop.height}%`}
					}
				/>
			)}
		</span>
	)
}
