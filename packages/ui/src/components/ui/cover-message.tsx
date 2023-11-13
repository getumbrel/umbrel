import {Portal} from '@radix-ui/react-portal'
import {useTimeout} from 'react-use'

/** Covers entire screen to show a message */
export function CoverMessage({children, delayed}: {children: React.ReactNode; delayed?: boolean}) {
	const [show] = useTimeout(600)

	return (
		<Portal>
			<div className='fixed inset-0 z-50 flex flex-col items-center justify-center gap-1 bg-black'>
				{!delayed ? children : show() && children}
			</div>
		</Portal>
	)
}
