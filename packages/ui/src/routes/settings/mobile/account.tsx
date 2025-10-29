import {useState} from 'react'
import {useParams} from 'react-router-dom'

import {SegmentedControl} from '@/components/ui/segmented-control'
import {usePassword} from '@/hooks/use-password'
import {useUserName} from '@/hooks/use-user-name'
import {ChangePasswordWarning, useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {Button} from '@/shadcn-components/ui/button'
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/shadcn-components/ui/drawer'
import {AnimatedInputError, Input, Labeled, PasswordInput} from '@/shadcn-components/ui/input'
import {t} from '@/utils/i18n'

export function AccountDrawer() {
	const title = t('account')

	const dialogProps = useSettingsDialogProps()
	const closeDialog = () => dialogProps.onOpenChange(false)

	const tabs = [
		{id: 'change-name', label: t('name')},
		{id: 'change-password', label: t('password')},
	] as const
	type TabId = (typeof tabs)[number]['id']

	const {accountTab} = useParams<{accountTab: TabId}>()
	const [activeTab, setActiveTab] = useState(accountTab ?? tabs[0].id)

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('account-description')}</DrawerDescription>
				</DrawerHeader>
				<DrawerScroller>
					<SegmentedControl size='lg' tabs={tabs} value={activeTab} onValueChange={setActiveTab} />
					{activeTab === 'change-name' && <ChangeName closeDialog={closeDialog} />}
					{activeTab === 'change-password' && <ChangePassword closeDialog={closeDialog} />}
				</DrawerScroller>
			</DrawerContent>
		</Drawer>
	)
}

function ChangeName({closeDialog}: {closeDialog: () => void}) {
	const {name, setName, handleSubmit, formError, isLoading} = useUserName({onSuccess: closeDialog})

	return (
		<form onSubmit={handleSubmit} className='flex flex-1 flex-col'>
			<fieldset disabled={isLoading} className='flex flex-1 flex-col gap-5'>
				<Labeled label={t('change-name.input-placeholder')}>
					<Input value={name} onValueChange={setName} />
				</Labeled>
				<div className='-my-2.5'>
					<AnimatedInputError>{formError}</AnimatedInputError>
				</div>
				<div className='flex-1' />
				<DrawerFooter>
					<Button type='button' size='dialog' onClick={closeDialog}>
						{t('cancel')}
					</Button>
					<Button type='submit' size='dialog' variant='primary'>
						{t('confirm')}
					</Button>
				</DrawerFooter>
				<div className='' />
			</fieldset>
		</form>
	)
}

function ChangePassword({closeDialog}: {closeDialog: () => void}) {
	const {
		password,
		setPassword,
		newPassword,
		setNewPassword,
		newPasswordRepeat,
		setNewPasswordRepeat,
		handleSubmit,
		fieldErrors,
		formError,
		isLoading,
	} = usePassword({onSuccess: closeDialog})

	return (
		<form onSubmit={handleSubmit} className='flex flex-1 flex-col'>
			<fieldset disabled={isLoading} className='flex flex-1 flex-col flex-col gap-5'>
				<ChangePasswordWarning />
				<Labeled label={t('change-password.current-password')}>
					<PasswordInput value={password} onValueChange={setPassword} />
				</Labeled>
				<Labeled label={t('change-password.new-password')}>
					<PasswordInput value={newPassword} onValueChange={setNewPassword} error={fieldErrors.oldPassword} />
				</Labeled>
				<Labeled label={t('change-password.repeat-password')}>
					<PasswordInput
						value={newPasswordRepeat}
						onValueChange={setNewPasswordRepeat}
						error={fieldErrors.newPassword}
					/>
				</Labeled>
				<div className='flex-1' />
				<div className='-my-2.5'>
					<AnimatedInputError>{formError}</AnimatedInputError>
				</div>

				<DrawerFooter>
					<Button type='button' size='dialog' onClick={closeDialog}>
						{t('cancel')}
					</Button>
					<Button type='submit' size='dialog' variant='primary'>
						{t('confirm')}
					</Button>
				</DrawerFooter>
			</fieldset>
		</form>
	)
}
