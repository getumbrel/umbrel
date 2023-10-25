import {Link, useNavigate} from 'react-router-dom'

import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass, formGroupClass, Layout} from '@/layouts/bare/shared'
import {links} from '@/links'
import {Input, PasswordInput} from '@/shadcn-components/ui/input'

export function CreateAccount() {
	useUmbrelTitle('Create account')
	const navigate = useNavigate()

	const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		navigate('/onboarding/2-account-created', {
			unstable_viewTransition: true,
		})
	}

	return (
		<Layout
			title='Create account'
			transitionTitle={false}
			subTitle='Your account info is stored only on your Umbrel. Make sure to back up your password safely as there is no way to reset it.'
			subTitleMaxWidth={630}
			footer={
				<Link to={links.support} target='_blank'>
					Contact support
				</Link>
			}
		>
			<form onSubmit={onSubmit} className='flex w-full flex-col items-center gap-5'>
				<div className={formGroupClass}>
					<Input placeholder='Name' autoFocus />
					<PasswordInput label='Password' />
					<PasswordInput label='Confirm password' />
				</div>
				<button type='submit' className={buttonClass}>
					Create
				</button>
			</form>
		</Layout>
	)
}
