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

// The hint answers an edit the document turns away (a new paragraph, formatting) with a nudge: a change of colour
// alone, with reduced motion
export function nudge(hint: HTMLElement | null) {
	const still = matchMedia('(prefers-reduced-motion: reduce)').matches
	hint?.animate(
		still
			? [{color: 'rgb(255 255 255)'}, {color: 'rgb(255 255 255 / 0.6)'}]
			: [
					{color: 'rgb(255 255 255 / 0.6)', transform: 'none'},
					{color: 'rgb(255 255 255)', transform: 'scale(1.04)', offset: 0.3},
					{color: 'rgb(255 255 255 / 0.6)', transform: 'none'},
				],
		{duration: 450, easing: 'cubic-bezier(0.22, 1, 0.36, 1)'},
	)
}
