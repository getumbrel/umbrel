import {useState} from 'react'
import {JSONTree} from 'react-json-tree'

import {ErrorAlert} from '@/components/ui/alert'
import {JWT_LOCAL_STORAGE_KEY} from '@/modules/auth/shared'
import {useAuth} from '@/modules/auth/use-auth'
import {Button} from '@/shadcn-components/ui/button'
import {Input} from '@/shadcn-components/ui/input'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export default function LoginTest() {
	const {loginWithJwt, refreshToken, jwt} = useAuth()
	const loginMut = trpcReact.user.login.useMutation({
		onSuccess: loginWithJwt,
	})

	const [password, setPassword] = useState('')

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		loginMut.mutate({password, totpToken: ''})
	}

	const registerMut = trpcReact.user.register.useMutation({
		onSuccess: () => {
			loginMut.mutate({password, totpToken: ''})
		},
	})

	const debug = trpcReact.user.get.useQuery()

	return (
		<form className='flex w-full flex-col items-center gap-5' onSubmit={handleSubmit}>
			<div>
				<Input placeholder={t('login.password-label')} autoFocus value={password} onValueChange={setPassword} />
			</div>
			<button type='submit'>{t('login.password.submit')}</button>
			<button
				type='button'
				onClick={() => {
					registerMut.mutate({name: 'umbrel', password: 'umbrel'})
				}}
			>
				{t('create-user')}
			</button>
			{loginMut.error && <ErrorAlert description={loginMut.error.message} />}
			<Button onClick={refreshToken}>Refresh Token</Button>
			<JSONTree data={{jwt, localStorageJwt: localStorage.getItem(JWT_LOCAL_STORAGE_KEY)}} />
			<Button
				onClick={() => {
					localStorage.removeItem(JWT_LOCAL_STORAGE_KEY)
					window.location.reload()
				}}
			>
				Log out (Remove JWT from localStorage)
			</Button>
			<JSONTree data={debug.data} />
			<Button onClick={() => debug.refetch()}>Refetch debug</Button>
		</form>
	)
}
