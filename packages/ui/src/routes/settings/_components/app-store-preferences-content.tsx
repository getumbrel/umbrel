import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLock, TbPlus, TbTrash} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {Input, PasswordInput} from '@/components/ui/input'
import {listClass, listItemClass} from '@/components/ui/list'
import {trpcReact} from '@/trpc/trpc'

export function AppStorePreferencesContent() {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()

	const credentialsQ = trpcReact.appStore.getRegistryCredentials.useQuery()
	const setMut = trpcReact.appStore.setRegistryCredential.useMutation({
		onSuccess: () => utils.appStore.getRegistryCredentials.invalidate(),
	})
	const removeMut = trpcReact.appStore.removeRegistryCredential.useMutation({
		onSuccess: () => utils.appStore.getRegistryCredentials.invalidate(),
	})

	const [showForm, setShowForm] = useState(false)
	const [registry, setRegistry] = useState('')
	const [username, setUsername] = useState('')
	const [password, setPassword] = useState('')

	const resetForm = () => {
		setRegistry('')
		setUsername('')
		setPassword('')
		setShowForm(false)
	}

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault()
		await setMut.mutateAsync({registry: registry.trim(), username: username.trim(), password})
		resetForm()
	}

	const credentials = credentialsQ.data ?? []

	return (
		<div className='flex flex-col gap-4'>
			<div>
				<h3 className='flex items-center gap-2 text-15 font-semibold'>
					<TbLock className='h-4 w-4 opacity-60' />
					{t('settings.app-store-preferences.registry-credentials.title')}
				</h3>
				<p className='mt-1 text-13 text-white/40'>
					{t('settings.app-store-preferences.registry-credentials.description')}
				</p>
			</div>

			{credentials.length > 0 && (
				<div className={listClass}>
					{credentials.map(({registry: reg}) => (
						<div key={reg} className={listItemClass}>
							<span className='truncate font-mono text-13'>{reg}</span>
							<Button
								size='sm'
								className='text-destructive2-lightest shrink-0'
								disabled={removeMut.isPending}
								onClick={() => removeMut.mutate({registry: reg})}
							>
								<TbTrash className='h-3.5 w-3.5' />
								{t('settings.app-store-preferences.registry-credentials.remove')}
							</Button>
						</div>
					))}
				</div>
			)}

			{!showForm && (
				<Button size='sm' className='self-start' onClick={() => setShowForm(true)}>
					<TbPlus className='h-3.5 w-3.5' />
					{t('settings.app-store-preferences.registry-credentials.add-button')}
				</Button>
			)}

			{showForm && (
				<form onSubmit={handleSave} className='flex flex-col gap-3'>
					<Input
						placeholder={t('settings.app-store-preferences.registry-credentials.registry-placeholder')}
						value={registry}
						onValueChange={setRegistry}
						autoFocus
					/>
					<Input
						placeholder={t('settings.app-store-preferences.registry-credentials.username-placeholder')}
						value={username}
						onValueChange={setUsername}
					/>
					<PasswordInput
						placeholder={t('settings.app-store-preferences.registry-credentials.token-placeholder')}
						value={password}
						onValueChange={setPassword}
					/>
					<div className='flex gap-2'>
						<Button
							type='submit'
							size='sm'
							variant='primary'
							disabled={!registry.trim() || !username.trim() || !password || setMut.isPending}
						>
							{t('settings.app-store-preferences.registry-credentials.save')}
						</Button>
						<Button type='button' size='sm' onClick={resetForm}>
							{t('cancel')}
						</Button>
					</div>
				</form>
			)}
		</div>
	)
}
