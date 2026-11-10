import {useQuery} from '@tanstack/react-query'
import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {useViewerSize, ViewerBackdrop, type ViewerSize} from '@/features/files/components/file-viewer/shell/context'
import {StageDownload, StageLoading, StageMessage} from '@/features/files/components/file-viewer/shell/stage-states'
import {fileViewUrl, useFileSource} from '@/features/files/components/file-viewer/shell/use-file-bytes'
import type {ViewerProps} from '@/features/files/components/file-viewer/viewers'
import {RENDERED_IMAGE_TYPES} from '@/features/files/constants'
import type {FileSystemItem} from '@/features/files/types'
import {cn} from '@/lib/utils'
import {useAuthorizedHttpUrl} from '@/modules/auth/http-auth'
import {trpcReact} from '@/trpc/trpc'

// Where the picture is read from: the file, or its rendition (see
// RENDERED_IMAGE_TYPES), which has no URL while it's being made and fails if
// it can't be. A file held in memory (an archive's entry) is shown from there,
// as it is: none of the types that need a rendition is opened from memory.
function usePicture(item: FileSystemItem) {
	// The React client, as the listing's thumbnails ask: a request held open
	// while the rendition is made stays out of the pool pictures load through
	const {client: trpc} = trpcReact.useUtils()
	const source = useFileSource()
	const svg = source && item.type === 'image/svg+xml' ? source.blob : undefined
	const svgUrl = useSvgDataUrl(svg)
	const rendered = !source && RENDERED_IMAGE_TYPES.has(item.type)
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
	const url = useAuthorizedHttpUrl(source ? undefined : rendered ? rendition.data : fileViewUrl(item.path))
	if (source) return {url: svg ? svgUrl : source.url, failed: false}
	return {url, failed: rendition.isError}
}

// An SVG held in memory, as a data: URL to show it from. Its object URL is
// never typed as SVG, as a picture must be: that URL has our origin, and an
// SVG opened from it as a page (in a new tab, say) could run script as us. A
// data: URL has no origin of its own, and a browser won't open one as a page.
function useSvgDataUrl(blob: Blob | undefined) {
	const [url, setUrl] = useState<{blob: Blob; url: string}>()
	useEffect(() => {
		if (!blob) return
		const reader = new FileReader()
		reader.onload = () => setUrl({blob, url: reader.result as string})
		reader.readAsDataURL(new Blob([blob], {type: 'image/svg+xml'}))
		return () => reader.abort()
	}, [blob])
	return blob && url?.blob === blob ? url.url : undefined
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
