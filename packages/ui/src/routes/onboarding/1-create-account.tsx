import {useState} from 'react'
import {Link} from 'react-router-dom'

import {Loading} from '@/components/ui/loading'
import {links} from '@/constants/links'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass, footerLinkClass, formGroupClass, Layout} from '@/layouts/bare/shared'
import {useAuth} from '@/modules/auth/use-auth'
import {AnimatedInputError, Input, PasswordInput} from '@/shadcn-components/ui/input'
import {trpcReact} from '@/trpc/trpc'

export default function CreateAccount() {
	const title = 'Create account'
	useUmbrelTitle(title)
	const auth = useAuth()

	const [name, setName] = useState('')
	const [password, setPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [localError, setLocalError] = useState('')
	const [isNavigating, setIsNavigating] = useState(false)

	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: async (jwt) => {
			setIsNavigating(true)
			auth.signUpWithJwt(jwt)
		},
	})

	const registerMut = trpcReact.user.register.useMutation({
		onSuccess: async () => loginMut.mutate({password, totpToken: ''}),
	})

	const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		// Reset errors
		registerMut.reset()
		setLocalError('')

		if (!name) {
			setLocalError('Name is required')
			return
		}

		if (password !== confirmPassword) {
			setLocalError('Passwords do not match')
			return
		}

		registerMut.mutate({name, password})
	}

	const remoteFormError = !registerMut.error?.data?.zodError && registerMut.error?.message
	const formError = localError || remoteFormError
	const isLoading = registerMut.isLoading || loginMut.isLoading || isNavigating

	return (
		<Layout
			title={title}
			transitionTitle={false}
			subTitle='Your account info is stored only on your Umbrel. Make sure to back up your password safely as there is no way to reset it.'
			subTitleMaxWidth={630}
			footer={
				<Link to={links.support} target='_blank' className={footerLinkClass}>
					Contact support
				</Link>
			}
		>
			<form onSubmit={onSubmit} className='w-full'>
				<fieldset disabled={isLoading} className='flex flex-col items-center gap-5'>
					<div className={formGroupClass}>
						<Input placeholder='Name' autoFocus value={name} onValueChange={setName} />
						<PasswordInput
							label='Password'
							value={password}
							onValueChange={setPassword}
							error={registerMut.error?.data?.zodError?.fieldErrors['password']?.join('. ')}
						/>
						<PasswordInput label='Confirm password' value={confirmPassword} onValueChange={setConfirmPassword} />
					</div>

					<div className='-my-2.5'>
						<AnimatedInputError>{formError}</AnimatedInputError>
					</div>
					<button type='submit' className={buttonClass}>
						{isLoading ? <Loading>Creating</Loading> : 'Create'}
					</button>
				</fieldset>
			</form>
		</Layout>
	)
}
