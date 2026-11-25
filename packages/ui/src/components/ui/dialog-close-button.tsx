import * as DialogPrimitive from '@radix-ui/react-dialog'
import {useTranslation} from 'react-i18next'
import {RiCloseCircleFill} from 'react-icons/ri'

import {cn} from '@/lib/utils'
import {dialogHeaderCircleButtonClass} from '@/utils/element-classes'
import {tw} from '@/utils/tw'

// Roughly concentric with --window-radius, which is 40px from lg and 24px below it.
// The modal inset would push the circle through a 40px curve.
const windowClosePlacementClass = tw`pointer-events-auto absolute top-3 right-3 z-[60] lg:top-5 lg:right-5`

// Keeps the glyph legible over a photo or a video, and is lost on these near-black
// surfaces. Sheets are lighter and never run media under the corner, so they go without.
const closeBackingClass = tw`before:absolute before:inset-[9%] before:rounded-full before:bg-black/60`

const closeSurfaceClass = {
	modal: `${tw`pointer-events-auto absolute top-2 right-2 z-[60]`} ${closeBackingClass}`,
	immersive: `${windowClosePlacementClass} ${closeBackingClass}`,
	sheet: windowClosePlacementClass,
}

// The cross RiCloseCircleFill cuts out of its circle, to draw over it on its own
const CROSS_PATH =
	'M12 10.5858L9.17157 7.75736L7.75736 9.17157L10.5858 12L7.75736 14.8284L9.17157 16.2426L12 13.4142L14.8284 16.2426L16.2426 14.8284L13.4142 12L16.2426 9.17157L14.8284 7.75736L12 10.5858Z'

export function CloseButton({
	className,
	crossClassName,
	...props
}: React.ComponentProps<'button'> & {
	/** Colours the cross on its own, filling the cut-out that otherwise shows what's behind the circle */
	crossClassName?: string
}) {
	const {t} = useTranslation()
	return (
		<button type='button' className={cn(dialogHeaderCircleButtonClass, className)} {...props}>
			<RiCloseCircleFill className='h-5 w-5 lg:h-6 lg:w-6' />
			{crossClassName && (
				// Wrapped, so the circle's dimming (on the button's svg children) passes it by
				<span aria-hidden className={cn('absolute inset-0', crossClassName)}>
					<svg viewBox='0 0 24 24' className='size-full fill-current'>
						<path d={CROSS_PATH} />
					</svg>
				</span>
			)}
			<span className='sr-only'>{t('close')}</span>
		</button>
	)
}

// The one close button in umbrelOS. Windows draw it themselves (see DialogContent and
// ImmersiveDialogContent), so a caller only ever renders it for a hand-built surface.
export function DialogCloseButton({
	surface = 'modal',
	crossClassName,
}: {
	surface?: keyof typeof closeSurfaceClass
	crossClassName?: string
}) {
	return (
		<DialogPrimitive.Close asChild>
			<CloseButton
				data-close-surface={surface}
				className={closeSurfaceClass[surface]}
				crossClassName={crossClassName}
			/>
		</DialogPrimitive.Close>
	)
}
