import {Bold, Italic, Redo2, Underline, Undo2} from 'lucide-react'
import {useLayoutEffect, useState, type Ref} from 'react'
import {useTranslation} from 'react-i18next'

import type {DocxDocument} from '@/features/files/components/file-viewer/document-viewer/engine'
import {stageTopClass} from '@/features/files/components/file-viewer/shell/stage-states'
import {
	floatingGlassClass,
	keepFocus,
	PillButton,
	PillDivider,
} from '@/features/files/components/file-viewer/shell/zoom-pill'
import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

const FORMATS = [
	{format: 'bold', icon: Bold, label: 'files-document.bold'},
	{format: 'italic', icon: Italic, label: 'files-document.italic'},
	{format: 'underline', icon: Underline, label: 'files-document.underline'},
] as const

// A button takes the bar's colour rather than its own, so that a nudge of the bar (which flashes it) shows on it
const inherit = tw`text-current`

// What the selection's text has of each format (nothing while it isn't in text that can be edited), and what there is
// to undo and redo
const read = (doc: DocxDocument) => ({formatting: doc.formatting(), history: doc.history})

// Bold, italic and underline for the selected text (or for what's typed next at the caret), then undo and redo:
// floating at the top of the stage while a document is edited, where a PDF's markup tools are.
export function FormatBar({
	ref,
	doc,
	version,
}: {
	ref: Ref<HTMLDivElement>
	doc: DocxDocument
	// Bumped when the document changes what it says of its formatting or history
	version: number
}) {
	const {t} = useTranslation()
	const [{formatting, history}, setState] = useState(() => read(doc))

	// Read again as the selection moves and, with `version`, as the document changes
	useLayoutEffect(() => {
		let frame = 0
		const update = () => {
			frame = 0
			setState(read(doc))
		}
		const moved = () => {
			frame ||= requestAnimationFrame(update)
		}
		update()
		document.addEventListener('selectionchange', moved)
		return () => {
			cancelAnimationFrame(frame)
			document.removeEventListener('selectionchange', moved)
		}
	}, [doc, version])

	return (
		<div
			className={cn(
				stageTopClass,
				'motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in motion-safe:slide-in-from-top-1',
			)}
		>
			<div
				ref={ref}
				role='toolbar'
				aria-label={t('files-document.formatting')}
				// A press anywhere on it leaves the keyboard, and the selection, in the text
				onMouseDown={keepFocus}
				className={cn(
					floatingGlassClass,
					'pointer-events-auto flex h-10 items-center gap-0.5 rounded-full px-1 text-white/80',
				)}
			>
				{FORMATS.map(({format, icon, label}) => {
					const on = formatting?.[format] ?? false
					return (
						<PillButton
							key={format}
							icon={icon}
							label={t(label)}
							tooltipSide='bottom'
							active={on}
							// Nothing to format while the selection isn't in text that can be edited
							disabled={!formatting}
							onClick={() => doc.format(format)}
							className={on ? undefined : inherit}
						/>
					)
				})}
				<PillDivider />
				<PillButton
					icon={Undo2}
					label={t('files-viewer.undo')}
					tooltipSide='bottom'
					disabled={!history.undo}
					onClick={() => doc.undo()}
					className={inherit}
				/>
				<PillButton
					icon={Redo2}
					label={t('files-viewer.redo')}
					tooltipSide='bottom'
					disabled={!history.redo}
					onClick={() => doc.redo()}
					className={inherit}
				/>
			</div>
		</div>
	)
}
