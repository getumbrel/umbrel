import {useState} from 'react'

import {trpcReact} from '@/trpc/trpc'
import {sleep} from '@/utils/misc'

export function usePassword({onSuccess}: {onSuccess: () => void}) {
	const [password, setPassword] = useState('')
	const [newPassword, setNewPassword] = useState('')
	const [newPasswordRepeat, setNewPasswordRepeat] = useState('')
	const [localError, setLocalError] = useState('')

	const changePasswordMut = trpcReact.user.changePassword.useMutation({
		onSuccess: async () => {
			await sleep(500)
			onSuccess()
		},
	})

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		// Reset errors
		changePasswordMut.reset()
		setLocalError('')

		if (!password) {
			setLocalError('Current password is required')
			return
		}

		if (!newPassword) {
			setLocalError('New password is required')
			return
		}

		if (!newPasswordRepeat) {
			setLocalError('Repeat password is required')
			return
		}

		if (newPassword !== newPasswordRepeat) {
			setLocalError('Passwords do not match')
			return
		}

		if (password === newPassword) {
			setLocalError('New password must be different from current password')
			return
		}

		changePasswordMut.mutate({oldPassword: password, newPassword})
	}

	const remoteFormError = !changePasswordMut.error?.data?.zodError && changePasswordMut.error?.message
	const formError = localError || remoteFormError

	const fieldErrors = {
		oldPassword: changePasswordMut.error?.data?.zodError?.fieldErrors['oldPassword']?.join('. '),
		newPassword: changePasswordMut.error?.data?.zodError?.fieldErrors['newPassword']?.join('. '),
	}

	return {
		password,
		setPassword,
		newPassword,
		setNewPassword,
		newPasswordRepeat,
		setNewPasswordRepeat,
		handleSubmit,
		formError,
		fieldErrors,
		isLoading: changePasswordMut.isLoading,
	}
}
