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

export function CloseButton({className, ...props}: React.ComponentProps<'button'>) {
	const {t} = useTranslation()
	return (
		<button type='button' className={cn(dialogHeaderCircleButtonClass, className)} {...props}>
			<RiCloseCircleFill className='h-5 w-5 lg:h-6 lg:w-6' />
			<span className='sr-only'>{t('close')}</span>
		</button>
	)
}

// The one close button in umbrelOS. Windows draw it themselves (see DialogContent and
// ImmersiveDialogContent), so a caller only ever renders it for a hand-built surface.
export function DialogCloseButton({surface = 'modal'}: {surface?: keyof typeof closeSurfaceClass}) {
	return (
		<DialogPrimitive.Close asChild>
			<CloseButton data-close-surface={surface} className={closeSurfaceClass[surface]} />
		</DialogPrimitive.Close>
	)
}
