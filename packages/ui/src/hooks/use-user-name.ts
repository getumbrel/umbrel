import {useState} from 'react'

import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {sleep} from '@/utils/misc'

export function useUserName({onSuccess}: {onSuccess: () => void}) {
	const userQ = trpcReact.user.get.useQuery()

	const [name, setName] = useState(userQ.data?.name)
	const [localError, setLocalError] = useState('')

	const utils = trpcReact.useUtils()

	const setMut = trpcReact.user.set.useMutation({
		onSuccess: async () => {
			await sleep(500)
			utils.user.get.invalidate()
			onSuccess()
		},
	})

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		// Reset errors
		setMut.reset()

		// So setLocalError('') is not batched
		await setLocalError('')

		if (!name) {
			setLocalError(t('change-name.failed.name-required'))
			return
		}

		setMut.mutate({name})
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
