import {useEffect} from 'react'
import {useTranslation} from 'react-i18next'

import {AnimatedInputError} from '@/components/ui/input'
import {PinInput} from '@/components/ui/pin-input'
import {footerLinkClass} from '@/layouts/bare/shared'

// The 2FA code step shared by the lock screen and the app proxy login page.
// Pure props, like LoginForm, so app-auth can bundle it.
export function TwoFactorForm({
	onCodeCheck,
	error,
	isPending,
	onBack,
}: {
	onCodeCheck: (code: string) => Promise<boolean>
	error?: string
	isPending: boolean
	onBack: () => void
}) {
	const {t} = useTranslation()

	// Escape goes back as well, unless a dialog on top already handled it
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && !event.defaultPrevented && !isPending) onBack()
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [isPending, onBack])

	return (
		<div className='flex flex-col items-center gap-5'>
			<div className='flex flex-col items-center'>
				<PinInput autoFocus length={6} onCodeCheck={onCodeCheck} />
				<div role='alert'>
					<AnimatedInputError>{error}</AnimatedInputError>
				</div>
			</div>
			<button type='button' className={footerLinkClass} disabled={isPending} onClick={onBack}>
				{t('back')}
			</button>
		</div>
	)
}
