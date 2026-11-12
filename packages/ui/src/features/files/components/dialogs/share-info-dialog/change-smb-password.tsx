import {ChevronDown, ChevronUp} from 'lucide-react'
import {AnimatePresence, motion} from 'motion/react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {PasswordInput} from '@/components/ui/input'
import {toast, ToastArea} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'

/**
 * Collapsible "Change SMB password" section shown below the connection
 * instructions, styled like the Time Machine accordion in the macOS steps.
 */
export function ChangeSmbPassword({toastArea}: {toastArea: ToastArea}) {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	const setSharePassword = trpcReact.files.setSharePassword.useMutation()

	const [isOpen, setIsOpen] = useState(false)
	const [newPassword, setNewPassword] = useState('')
	const [passwordError, setPasswordError] = useState('')

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault()
		setPasswordError('')
		if (newPassword.length < 6) return setPasswordError(t('settings.file-sharing.password-too-short'))
		if (newPassword.length > 127) return setPasswordError(t('settings.file-sharing.password-too-long'))

		try {
			await setSharePassword.mutateAsync({password: newPassword})
			await utils.files.sharePassword.invalidate()
			setNewPassword('')
			toast.success(t('settings.file-sharing.password-changed'), {area: toastArea})
		} catch (error) {
			toast.error(t('settings.file-sharing.password-change-failed'), {
				area: toastArea,
				description: error instanceof Error ? error.message : String(error),
			})
		}
	}

	return (
		<div className='space-y-4'>
			<button
				onClick={() => setIsOpen(!isOpen)}
				className='flex w-full items-center justify-between text-xs font-medium text-brand-lightest transition-opacity duration-300 hover:opacity-80'
			>
				{t('settings.file-sharing.change-smb-password')}
				{isOpen ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
			</button>

			<AnimatePresence>
				{isOpen && (
					<motion.div
						initial={{height: 0, opacity: 0}}
						animate={{height: 'auto', opacity: 1}}
						exit={{height: 0, opacity: 0}}
						transition={{duration: 0.3}}
						className='overflow-hidden'
					>
						<form onSubmit={handleSubmit} className='flex flex-col gap-3 px-1 pb-1'>
							<p className='text-12 leading-tight text-white/40'>{t('settings.file-sharing.password-description')}</p>
							<div className='flex flex-wrap items-start gap-2'>
								<PasswordInput
									sizeVariant='short'
									className='min-w-[12rem] flex-1'
									label={t('settings.file-sharing.new-password')}
									value={newPassword}
									error={passwordError}
									onValueChange={(value) => {
										setNewPassword(value)
										setPasswordError('')
									}}
								/>
								<Button
									type='submit'
									variant='primary'
									size='input-short'
									disabled={!newPassword || setSharePassword.isPending}
								>
									{t('settings.file-sharing.change-password')}
								</Button>
							</div>
						</form>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	)
}
