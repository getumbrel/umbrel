import {useState} from 'react'

import {trpcReact} from '@/trpc/trpc'
import {sleep} from '@/utils/misc'

export function useUserName({onSuccess}: {onSuccess: () => void}) {
	const userQ = trpcReact.user.get.useQuery()

	const [name, setName] = useState(userQ.data?.name)
	const [localError, setLocalError] = useState('')

	const ctx = trpcReact.useContext()

	const setMut = trpcReact.user.set.useMutation({
		onSuccess: async () => {
			await sleep(500)
			ctx.user.get.invalidate()
			onSuccess()
		},
	})

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		// Reset errors
		setMut.reset()
		setLocalError('')

		if (!name) {
			setLocalError('Name is required')
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
		isLoading: setMut.isLoading,
	}
}
