import {useState} from 'react'
import {Link, useNavigate} from 'react-router-dom'

import {links} from '@/constants/links'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass, footerLinkClass, formGroupClass, Layout} from '@/layouts/bare/shared'
import {AnimatedInputError, Input, PasswordInput} from '@/shadcn-components/ui/input'
import {trpcReact} from '@/trpc/trpc'

export function CreateAccount() {
	useUmbrelTitle('Create account')
	const navigate = useNavigate()
	const [name, setName] = useState('')
	const [password, setPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [localError, setLocalError] = useState('')

	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: (jwt) => {
			window.localStorage.setItem('jwt', jwt)
		},
	})

	const ctx = trpcReact.useContext()

	const registerMut = trpcReact.user.register.useMutation({
		onSuccess: async () => {
			await loginMut.mutate({password, totpToken: ''})

			// Doing just invalidate() or just prefetch() doesn't work for the next page that requires user data to already exist to avoid `undefined` appearing
			// Consider setting a query param in the next page.
			await ctx.user.get.invalidate()
			await ctx.user.get.prefetch()
			navigate('/onboarding/2-account-created', {
				unstable_viewTransition: true,
			})
		},
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

	return (
		<Layout
			title='Create account'
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
				<fieldset className='flex flex-col items-center gap-5'>
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
						Create
					</button>
				</fieldset>
			</form>
		</Layout>
	)
}
