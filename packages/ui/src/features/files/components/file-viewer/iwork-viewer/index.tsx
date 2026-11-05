import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {ZipArchive} from '@/features/files/components/file-viewer/shared/zip'
import {stageButtonClass, StageLoading, StageMessage} from '@/features/files/components/file-viewer/shell/stage-states'
import {fileViewUrl, rangeReader} from '@/features/files/components/file-viewer/shell/use-file-bytes'
import {viewers, type ViewerProps} from '@/features/files/components/file-viewer/viewers'
import {cn} from '@/lib/utils'
import {useAuthorizedHttpUrl, useAuthorizedHttpUrlQuery} from '@/modules/auth/http-auth'

// Pages, Keynote and Numbers files carry Apple's own rendering of their first
// page, slide or sheet. Their real contents (protobuf archives that change
// with every Apple release) have no faithful open renderer, so the preview
// is what's shown, and said to be one.
const PREVIEWS = ['preview.jpg', 'preview-web.jpg', 'QuickLook/Thumbnail.jpg']

type Preview = {status: 'loading'} | {status: 'ready'; url: string} | {status: 'missing'} | {status: 'not-zip'}

export default function IworkViewer({item, mode}: ViewerProps) {
	const {t} = useTranslation()
	const view = useAuthorizedHttpUrlQuery(fileViewUrl(item.path))
	const downloadUrl = useAuthorizedHttpUrl(`/api/files/download?path=${encodeURIComponent(item.path)}`)
	const [preview, setPreview] = useState<Preview>({status: 'loading'})
	const [loaded, setLoaded] = useState(false)

	// Only the preview is read out of the package, with HTTP Range requests: the
	// package's end, where its directory is, then the preview's own bytes. A deck
	// with movies can be hundreds of megabytes; only its preview is kept, as a
	// blob.
	useEffect(() => {
		if (view.status !== 'ready') return
		const abort = new AbortController()
		const read = rangeReader(view.url, abort.signal)
		let url: string | undefined
		void (async () => {
			const archive = await ZipArchive.read(item.size ?? 0, read)
			const name = PREVIEWS.find((candidate) => archive.has(candidate))
			if (!name) return setPreview({status: 'missing'})
			const jpeg = await archive.bytes(name)
			if (abort.signal.aborted) return
			url = URL.createObjectURL(new Blob([jpeg], {type: 'image/jpeg'}))
			setPreview({status: 'ready', url})
		})().catch(async () => {
			// A file that doesn't start as a zip opens as text: a .key is as often a
			// PEM private key as a Keynote deck
			const head = await read(0, 2).catch(() => undefined)
			if (abort.signal.aborted) return
			setPreview({status: head && (head[0] !== 0x50 || head[1] !== 0x4b) ? 'not-zip' : 'missing'})
		})
		return () => {
			abort.abort()
			if (url) URL.revokeObjectURL(url)
		}
	}, [view.status, view.url, item.size])

	if (preview.status === 'not-zip') return <viewers.text.Component item={item} mode={mode} />
	if (view.status === 'error' || preview.status === 'missing') {
		return (
			<StageMessage item={item} title={t('files-iwork.no-preview-title')} detail={t('files-iwork.no-preview-detail')}>
				{downloadUrl && (
					<a href={downloadUrl} download={item.name} className={stageButtonClass}>
						{t('files-viewer.download')}
					</a>
				)}
			</StageMessage>
		)
	}

	const caption =
		item.type === 'application/vnd.apple.keynote'
			? t('files-iwork.keynote-caption')
			: item.type === 'application/vnd.apple.numbers'
				? t('files-iwork.numbers-caption')
				: t('files-iwork.pages-caption')

	// The picture with its caption right beneath it, centred together. Short of
	// room, the picture's row gives way first, and the picture keeps its shape.
	return (
		<div className='relative grid min-h-0 flex-1 grid-rows-[minmax(0,auto)_auto] place-content-center justify-items-center gap-4 px-4 pb-2 md:px-6'>
			{preview.status === 'ready' && (
				<img
					src={preview.url}
					alt={item.name}
					draggable={false}
					onLoad={() => setLoaded(true)}
					className={cn(
						'max-h-full max-w-full rounded-[2px] bg-white shadow-[0_8px_30px_rgb(0_0_0/0.35)] ring-1 ring-white/5 transition-opacity duration-200',
						loaded ? 'opacity-100' : 'opacity-0',
					)}
				/>
			)}
			{loaded ? (
				<p className='max-w-md text-center text-13 -tracking-2 text-white/50 motion-safe:animate-in motion-safe:fade-in'>
					{caption}
				</p>
			) : (
				<div className='absolute inset-0 flex'>
					<StageLoading item={item} />
				</div>
			)}
		</div>
	)
}
