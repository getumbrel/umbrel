import * as DialogPrimitive from '@radix-ui/react-dialog'
import {useReducedMotion} from 'motion/react'
import {Suspense, useRef, useState, type CSSProperties} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'

import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {ImmersiveDialog} from '@/components/ui/immersive-dialog'
import {InfoCard} from '@/features/files/components/file-viewer/info-card-viewer'
import {
	ViewerShellContext,
	type ViewerSaveHandler,
	type ViewerSize,
} from '@/features/files/components/file-viewer/shell/context'
import {StageDownload, StageLoading, StageMessage} from '@/features/files/components/file-viewer/shell/stage-states'
import {useViewerKeys} from '@/features/files/components/file-viewer/shell/use-viewer-keys'
import type {Viewer} from '@/features/files/components/file-viewer/viewers'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'
import {StageArrow} from '@/features/photos/components/viewer/lightbox-button'
import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

// The panel zooms in from a touch smaller as the scrim fades up, and back out
// as it closes. Stepping to another file fades only what's in the panel, which
// stays where it is and eases into the new file's shape. Entering fills
// backwards only, as the shell's does.
const panelEnter = tw`motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-[0.96] motion-safe:duration-200 motion-safe:fill-mode-backwards`
const panelLeave = tw`motion-safe:animate-out motion-safe:fade-out motion-safe:zoom-out-[0.96] motion-safe:duration-150 motion-safe:fill-mode-forwards`
const scrimEnter = tw`motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 motion-safe:fill-mode-backwards`
const scrimLeave = tw`motion-safe:animate-out motion-safe:fade-out motion-safe:duration-150 motion-safe:fill-mode-forwards`
const stageStep = tw`motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150`
// Long enough for the panel and the scrim to be gone
const LEAVE_MS = 160

// The most of the window the panel takes, and the room in it around a picture
// or a film: the title above, and the margin viewers keep beside and beneath
const PANEL_WIDTH = 'min(92vw, 1100px)'
const PANEL_HEIGHT = 'min(88dvh, 860px)'
const AROUND_X = '48px'
const AROUND_Y = '68px'

// A document has the panel at its largest. A picture or a film has it at its own
// shape, as large as the panel can be but never past its own size. Something
// Files has no viewer for is just its card.
function panelSize(viewer: Viewer | undefined, fit: ViewerSize | undefined): CSSProperties {
	if (!viewer) return {width: 'min(92vw, 22rem)'}
	if (!fit) return {width: PANEL_WIDTH, height: PANEL_HEIGHT}
	const media = `min(${PANEL_HEIGHT} - ${AROUND_Y}, (${PANEL_WIDTH} - ${AROUND_X}) * ${fit.height / fit.width}, ${fit.height}px)`
	return {
		width: `calc(${media} * ${fit.width / fit.height} + ${AROUND_X})`,
		height: `calc(${media} + ${AROUND_Y})`,
		minWidth: 'min(92vw, 20rem)',
	}
}

// Nothing in a quick look is saved, or described beyond its name
const ignore = () => {}

// A glance at a file without leaving the listing, which stays in view behind a
// light scrim: the file in a panel, under its name, and nothing to do to it.
// Space or Escape closes it, and ←/→ step through the folder.
export function QuickLook({item, viewer}: {item: FileSystemItem; viewer?: Viewer}) {
	const {t} = useTranslation()
	const reduceMotion = useReducedMotion() ?? false
	const isTouch = useIsTouchDevice()
	const setViewerItem = useFilesStore((s) => s.setViewerItem)
	const stepper = useFilesStore((s) => s.viewerStepper)

	const contentRef = useRef<HTMLDivElement>(null)
	// Where the keyboard was in the listing, to go back to as the panel closes:
	// Radix gives it back only to a trigger, which a quick look doesn't have
	const opener = useRef<Element | null>(null)
	const saveHandler = useRef<ViewerSaveHandler | null>(null)
	const escapeHandler = useRef<(() => boolean) | null>(null)
	// The shape of the last picture, kept while the next one comes in
	const [shape, setShape] = useState<ViewerSize & {viewer: Viewer}>()
	const fit = viewer && shape?.viewer === viewer ? shape : undefined
	const setSize = (size: ViewerSize) => setShape(viewer && {...size, viewer})
	const [closing, setClosing] = useState(false)
	// The first file settles in with the panel; later ones are stepped to
	const [openedPath] = useState(item.path)
	const [stepped, setStepped] = useState(false)
	if (!stepped && item.path !== openedPath) setStepped(true)

	const close = async () => {
		if (closing) return
		setClosing(true)
		await new Promise((resolve) => setTimeout(resolve, reduceMotion ? 0 : LEAVE_MS))
		setViewerItem(null)
	}
	// A menu over the file gives the keyboard back to the panel
	const returnFocus = (event: Event) => {
		event.preventDefault()
		contentRef.current?.focus()
	}

	// The key that opened it closes it
	useViewerKeys(contentRef, {onSpace: () => void close()})

	return (
		<ImmersiveDialog open onOpenChange={(open) => !open && void close()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay
					onClick={() => void close()}
					className={cn('fixed inset-0 z-50 bg-black/40', closing ? scrimLeave : scrimEnter)}
				/>
				<DialogPrimitive.Content
					ref={contentRef}
					tabIndex={-1}
					aria-describedby={undefined}
					// Focus moves into the panel, not onto a button in the file: no
					// ring on open, while the listing beneath stops hearing keys
					onOpenAutoFocus={(event) => {
						event.preventDefault()
						opener.current = document.activeElement
						contentRef.current?.focus()
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault()
						if (opener.current instanceof HTMLElement) opener.current.focus({preventScroll: true})
					}}
					// Escape unwinds the viewer's own state first (a search)
					onEscapeKeyDown={(event) => {
						if (escapeHandler.current?.()) event.preventDefault()
					}}
					// Only the scrim closes it, once clicked: a floating island or a
					// toast over it is pressed as itself
					onInteractOutside={(event) => event.preventDefault()}
					style={panelSize(viewer, fit)}
					className={cn(
						'group umbrel-material umbrel-material-modal fixed top-1/2 left-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col outline-hidden motion-safe:transition-[width,height] motion-safe:ease-out',
						viewer && 'pb-6',
						closing ? panelLeave : panelEnter,
					)}
				>
					{/* The card says the name of what has no viewer itself */}
					<DialogPrimitive.Title
						className={
							viewer
								? 'shrink-0 truncate px-10 text-center text-13 leading-11 font-medium -tracking-2 text-white/70'
								: 'sr-only'
						}
					>
						{item.name}
					</DialogPrimitive.Title>

					<ViewerShellContext
						value={{
							toolsSlot: null,
							backdropSlot: null,
							setDetail: ignore,
							setSize,
							setDirty: ignore,
							saveHandler,
							escapeHandler,
							returnFocus,
						}}
					>
						<div key={item.path} className={cn('relative flex min-h-0 flex-1 flex-col', stepped && stageStep)}>
							<ErrorBoundary
								fallbackRender={() => (
									<StageMessage
										item={item}
										title={t('files-viewer.error-title')}
										detail={t('files-viewer.error-detail')}
									>
										<StageDownload item={item} />
									</StageMessage>
								)}
							>
								<Suspense fallback={<StageLoading item={item} />}>
									{viewer ? <viewer.Component item={item} mode='preview' /> : <InfoCard item={item} />}
								</Suspense>
							</ErrorBoundary>
						</div>
					</ViewerShellContext>

					{/* Steps for the pointer, at the panel's edges once it's hovered */}
					{stepper && !isTouch && (
						<>
							<StageArrow
								side='left'
								label={t('files-viewer.previous')}
								disabled={!stepper.canStep('previous')}
								onClick={() => stepper.step('previous')}
							/>
							<StageArrow
								side='right'
								label={t('files-viewer.next')}
								disabled={!stepper.canStep('next')}
								onClick={() => stepper.step('next')}
							/>
						</>
					)}
					<DialogCloseButton />
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</ImmersiveDialog>
	)
}
