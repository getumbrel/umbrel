import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {PasswordInput} from '@/components/ui/input'
import {toast} from '@/components/ui/toast'
import {useShares} from '@/features/files/hooks/use-shares'

type Mode = 'custom' | 'regenerate'

export function SharePasswordDialog({
	mode,
	open,
	onOpenChange,
}: {
	mode: Mode
	open: boolean
	onOpenChange: (open: boolean) => void
}) {
	const {t} = useTranslation()
	const {setSharePassword, isSettingSharePassword, regenerateSharePassword, isRegeneratingSharePassword} = useShares()

	const [password, setPassword] = useState('')
	const [error, setError] = useState<string | undefined>()

	const reset = () => {
		setPassword('')
		setError(undefined)
	}

	const handleSetCustom = async () => {
		if (password.length < 8) {
			setError(t('settings.file-sharing.password-min-length'))
			return
		}
		try {
			await setSharePassword({password})
			toast.success(t('settings.file-sharing.password-toast-updated'))
			reset()
			onOpenChange(false)
		} catch {
			// useShares already surfaces a toast on error
		}
	}

	const handleRegenerate = async () => {
		try {
			await regenerateSharePassword()
			toast.success(t('settings.file-sharing.password-toast-regenerated'))
			onOpenChange(false)
		} catch {
			// useShares already surfaces a toast on error
		}
	}

	const isCustom = mode === 'custom'
	const isPending = isCustom ? isSettingSharePassword : isRegeneratingSharePassword

	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) reset()
				onOpenChange(next)
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{isCustom
							? t('settings.file-sharing.password-custom-title')
							: t('settings.file-sharing.password-regenerate-title')}
					</AlertDialogTitle>
					{!isCustom && (
						<AlertDialogDescription>
							{t('settings.file-sharing.password-regenerate-description')}
						</AlertDialogDescription>
					)}
				</AlertDialogHeader>

				{isCustom && (
					<div className='px-1 pb-2'>
						<PasswordInput
							label={t('settings.file-sharing.password-custom-label')}
							value={password}
							onValueChange={(value) => {
								setPassword(value)
								if (error) setError(undefined)
							}}
							error={error}
							autoFocus
						/>
					</div>
				)}

				<AlertDialogFooter>
					<AlertDialogAction
						className='px-6'
						disabled={isPending || (isCustom && password.length < 8)}
						onClick={isCustom ? handleSetCustom : handleRegenerate}
					>
						{isCustom
							? t('settings.file-sharing.password-action-save')
							: t('settings.file-sharing.password-action-regenerate')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('settings.file-sharing.password-action-cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
