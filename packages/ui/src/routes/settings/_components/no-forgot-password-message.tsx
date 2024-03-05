export function NoForgotPasswordMessage() {
	return (
		<p className='text-12 font-normal leading-tight -tracking-2 text-white/40'>
			There is no ‘Forgot password’ option, so we recommend you write down your password physically somewhere, in case
			you forget.
			{/* Add this back when we do password strength checking */}
			{/* https://surajmahraj.notion.site/umbrelOS-1-0-UI-Polish-a75c2f43893d49f4ae1e572e1455c33e#:~:text=My%20idea%20for%20%E2%80%98-,super%20strong,-%E2%80%99%20is%20that%20this */}
			{/* <Trans i18nKey='no-forgot-password-message' components={{em: <em className='not-italic text-success-light' />}} /> */}
		</p>
	)
}
