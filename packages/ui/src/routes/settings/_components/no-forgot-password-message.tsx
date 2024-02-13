import {Trans} from 'react-i18next/TransWithoutContext'

export function NoForgotPasswordMessage() {
	return (
		<p className='text-12 font-normal leading-tight -tracking-2 text-white/40'>
			<Trans i18nKey='no-forgot-password-message' components={{em: <em className='not-italic text-success-light' />}} />
		</p>
	)
}
