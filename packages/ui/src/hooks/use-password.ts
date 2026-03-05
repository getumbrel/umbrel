import {useState} from 'react'

import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
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
		// So setLocalError('') is not batched
		await setLocalError('')

		if (!password) {
			setLocalError(t('change-password.failed.current-required'))
			return
		}

		if (!newPassword) {
			setLocalError(t('change-password.failed.new-required'))
			return
		}

		if (!newPasswordRepeat) {
			setLocalError(t('change-password.failed.repeat-required'))
			return
		}

		if (newPassword !== newPasswordRepeat) {
			setLocalError(t('change-password.failed.no-match'))
			return
		}

		if (password === newPassword) {
			setLocalError(t('change-password.failed.must-be-unique'))
			return
		}

		if (newPassword.length < 6) {
			setLocalError(t('change-password.failed.min-length', {characters: 6}))
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
		isLoading: changePasswordMut.isPending,
	}
}
