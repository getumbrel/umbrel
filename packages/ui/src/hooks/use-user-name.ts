import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {trpcReact} from '@/trpc/trpc'
import {sleep} from '@/utils/misc'

export function useUserName({onSuccess}: {onSuccess: () => void}) {
	const {t} = useTranslation()
	const userQ = trpcReact.user.get.useQuery()

	const [name, setName] = useState(userQ.data?.name)
	const [localError, setLocalError] = useState('')

	const utils = trpcReact.useUtils()

	const setMut = trpcReact.user.set.useMutation({
		onSuccess: async () => {
			await sleep(500)
			await Promise.all([
				utils.user.get.invalidate(),
				utils.user.listAccounts.invalidate(),
				utils.files.shares.invalidate(),
			])
			onSuccess()
		},
	})

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		// Reset errors
		setMut.reset()

		// So setLocalError('') is not batched
		await setLocalError('')

		// A name of only spaces would leave the account blank everywhere it's shown
		const trimmedName = name?.trim()
		if (!trimmedName) {
			setLocalError(t('change-name.failed.name-required'))
			return
		}

		setMut.mutate({name: trimmedName})
	}

	const remoteFormError = !setMut.error?.data?.zodError && setMut.error?.message
	const formError = localError || remoteFormError

	return {
		name,
		setName,
		handleSubmit,
		formError,
		isLoading: setMut.isPending,
	}
}
