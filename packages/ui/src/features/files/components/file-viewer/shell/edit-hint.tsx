import type {Ref} from 'react'
import {useTranslation} from 'react-i18next'
import {RiEditLine} from 'react-icons/ri'

import {stageTopClass} from '@/features/files/components/file-viewer/shell/stage-states'
import {floatingGlassClass} from '@/features/files/components/file-viewer/shell/zoom-pill'
import {cn} from '@/lib/utils'

// What editing can change, shown while a viewer edits text in place. It floats at the top of the stage, where the
// notice would be (which steps aside meanwhile), over the paper as often as the dark around it.
export function EditHint({ref}: {ref: Ref<HTMLParagraphElement>}) {
	const {t} = useTranslation()
	return (
		<div
			className={cn(
				stageTopClass,
				'motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in motion-safe:slide-in-from-top-1',
			)}
		>
			<p
				ref={ref}
				role='status'
				className={cn(
					floatingGlassClass,
					'flex items-center gap-2 rounded-2xl px-3.5 py-1.5 text-12 leading-tight text-balance text-white/60',
				)}
			>
				<RiEditLine className='size-3.5 shrink-0 opacity-70' />
				{t('files-viewer.edit-hint')}
			</p>
		</div>
	)
}

// What floats over the stage for editing (the hint, or a document's format bar) answers an edit that's turned away
// with a nudge: a change of colour alone, with reduced motion. The keyframes left out are its own colour, whatever
// Increase contrast makes it.
export function nudge(element: HTMLElement | null) {
	const still = matchMedia('(prefers-reduced-motion: reduce)').matches
	element?.animate(
		still
			? [{color: 'rgb(255 255 255)', offset: 0}]
			: [{color: 'rgb(255 255 255)', transform: 'scale(1.04)', offset: 0.3}],
		{duration: 450, easing: 'cubic-bezier(0.22, 1, 0.36, 1)'},
	)
}
