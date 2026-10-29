import {useQuery} from '@tanstack/react-query'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {useViewerSize, ViewerBackdrop, type ViewerSize} from '@/features/files/components/file-viewer/shell/context'
import {StageDownload, StageLoading, StageMessage} from '@/features/files/components/file-viewer/shell/stage-states'
import {fileViewUrl} from '@/features/files/components/file-viewer/shell/use-file-bytes'
import type {ViewerProps} from '@/features/files/components/file-viewer/viewers'
import type {FileSystemItem} from '@/features/files/types'
import {cn} from '@/lib/utils'
import {useAuthorizedHttpUrl} from '@/modules/auth/http-auth'
import {trpcReact} from '@/trpc/trpc'

// Formats a browser can't be counted on to decode (HEIC, TIFF, camera RAW)
// are shown from the rendition umbreld makes of them for Photos: upright, 1280
// pixels on the short side. Always, even where the browser could decode the
// original (Safari reads HEIC and TIFF): a RAW or a TIFF runs to tens of
// megabytes, and the rendition looks the same everywhere. Download still
// gives the original.
const RENDERED_TYPES = new Set([
	'image/heic',
	'image/heif',
	'image/tiff',
	'image/x-adobe-dng',
	'image/x-canon-cr2',
	'image/x-canon-cr3',
	'image/x-nikon-nef',
	'image/x-sony-arw',
	'image/x-fuji-raf',
	'image/x-olympus-orf',
	'image/x-panasonic-rw2',
])

// Where the picture is read from: the file, or its rendition, which has no
// URL while it's being made and fails if it can't be
function usePicture(item: FileSystemItem) {
	// The React client, as the listing's thumbnails ask: a request held open
	// while the rendition is made stays out of the pool pictures load through
	const {client: trpc} = trpcReact.useUtils()
	const rendered = RENDERED_TYPES.has(item.type)
	const rendition = useQuery({
		// Under the file's revision, as the listing's thumbnails are
		queryKey: ['files-viewer-rendition', item.path, item.modified, item.size],
		queryFn: () => trpc.files.getThumbnail.mutate({path: item.path, variant: 'preview-1280-webp-v2'}),
		enabled: rendered,
		// Addressed by content, its URL never goes stale. One that couldn't be
		// made is asked for again the next time the file is opened.
		staleTime: Infinity,
		retry: false,
		refetchOnWindowFocus: false,
	})
	const url = useAuthorizedHttpUrl(rendered ? rendition.data : fileViewUrl(item.path))
	return {url, failed: rendition.isError}
}

export default function ImageViewer({item}: ViewerProps) {
	const {t} = useTranslation()
	const {url, failed} = usePicture(item)
	const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading')
	// The picture's own size, which a quick look takes the shape of
	const [size, setSize] = useState<ViewerSize>()
	useViewerSize(size)

	if (state === 'failed' || failed) {
		return (
			<StageMessage item={item} title={t('files-viewer.error-title')} detail={t('files-viewer.error-detail')}>
				<StageDownload item={item} />
			</StageMessage>
		)
	}

	return (
		<>
			{/* The picture itself, blown up and blurred, is the light around it */}
			{url && state === 'loaded' && (
				<ViewerBackdrop>
					<img
						src={url}
						alt=''
						aria-hidden='true'
						className='absolute inset-0 size-full scale-125 object-cover opacity-50 blur-[72px] motion-safe:animate-in motion-safe:duration-500 motion-safe:fade-in'
					/>
				</ViewerBackdrop>
			)}
			<div className='relative flex min-h-0 flex-1 flex-col'>
				{state === 'loading' && <StageLoading item={item} />}
				{url && (
					// Absolutely placed with auto margins, the element is exactly the
					// picture's fitted box, so the rounded corners land on the picture
					<img
						src={url}
						alt={item.name}
						draggable={false}
						onLoad={(event) => {
							setState('loaded')
							setSize({width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight})
						}}
						onError={() => setState('failed')}
						className={cn(
							'absolute inset-x-4 inset-y-0 m-auto max-h-full max-w-[calc(100%-2rem)] rounded-xl object-contain transition-opacity duration-200 md:inset-x-6 md:max-w-[calc(100%-3rem)]',
							state === 'loaded' ? 'opacity-100' : 'opacity-0',
						)}
					/>
				)}
			</div>
		</>
	)
}
