import {Portal} from '@radix-ui/react-portal'
import {useTimeout} from 'react-use'

import {Wallpaper} from '@/providers/wallpaper'
import {cn} from '@/shadcn-lib/utils'
import {tw} from '@/utils/tw'

import {DarkenLayer} from '../darken-layer'

/** Cover message without  */
export function BareCoverMessage({
	children,
	delayed,
	onClick,
}: {
	children: React.ReactNode
	delayed?: boolean
	onClick?: () => void
}) {
	const [show] = useTimeout(600)

	return (
		<CoverMessageContent>
			<div className='absolute inset-0 z-50 bg-black' onClick={onClick}>
				<div className={coverMessageBodyClass}>{!delayed ? children : show() && children}</div>
			</div>
		</CoverMessageContent>
	)
}

/** Covers entire screen to show a message */
export function CoverMessage({
	children,
	bodyClassName,
	onClick,
	delayed,
}: {
	children: React.ReactNode
	bodyClassName?: string
	onClick?: () => void
	delayed?: boolean
}) {
	const [show] = useTimeout(600)

	return (
		<CoverMessageContent>
			{/* <div className='absolute inset-0 z-50'> */}
			<Wallpaper className='z-50' stayBlurred />
			<DarkenLayer className='z-50 duration-700 animate-in fade-in' />
			<div onClick={onClick} className={cn(coverMessageBodyClass, bodyClassName)}>
				{!delayed ? children : show() && children}
			</div>
			{/* </div> */}
		</CoverMessageContent>
	)
}

// ---

export const COVER_MESSAGE_TARGET_ID = 'cover-message-id'

export function CoverMessageTarget() {
	return <div id={COVER_MESSAGE_TARGET_ID} />
}
export function CoverMessageContent({children}: {children: React.ReactNode}) {
	// `?? undefined` to ensure we put portal in default place otherwise
	return <Portal container={document.getElementById(COVER_MESSAGE_TARGET_ID) ?? undefined}>{children}</Portal>
}

export function CoverMessageParagraph({children, className}: {children: React.ReactNode; className?: string}) {
	return <p className={cn(tw`max-sm: px-4 text-center text-13 text-white/60`, className)}>{children}</p>
}

export const coverMessageBodyClass = tw`fixed inset-0 z-50 flex flex-col items-center justify-center gap-1 duration-700 animate-in fade-in fill-mode-both`
