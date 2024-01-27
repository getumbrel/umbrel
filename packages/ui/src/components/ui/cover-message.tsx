import {Portal} from '@radix-ui/react-portal'
import {useTimeout} from 'react-use'

import {Wallpaper} from '@/modules/desktop/wallpaper-context'
import {tw} from '@/utils/tw'

/** Cover message without  */
export function BareCoverMessage({children, delayed}: {children: React.ReactNode; delayed?: boolean}) {
	const [show] = useTimeout(600)

	return (
		<Portal>
			<div className='absolute inset-0 z-50 bg-black'>
				<div className={coverMessageBodyClass}>{!delayed ? children : show() && children}</div>
			</div>
		</Portal>
	)
}

/** Covers entire screen to show a message */
export function CoverMessage({children, delayed}: {children: React.ReactNode; delayed?: boolean}) {
	const [show] = useTimeout(600)

	return (
		<Portal>
			<div className='z-50'>
				<Wallpaper className='z-50' />
				<div className='absolute inset-0 z-50 backdrop-blur-2xl animate-in fade-in' />
				<div className={coverMessageBodyClass}>{!delayed ? children : show() && children}</div>
			</div>
		</Portal>
	)
}

export function CoverMessageParagraph({children}: {children: React.ReactNode}) {
	return <p className={tw`max-sm: px-4 text-center text-13 text-white/60`}>{children}</p>
}

const coverMessageBodyClass = tw`fixed inset-0 z-50 flex flex-col items-center justify-center gap-1`
