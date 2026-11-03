import {useTranslation} from 'react-i18next'
import {useNavigate, useParams} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {DrawerFooter} from '@/components/ui/drawer'
import {useDrawerOrDialog} from '@/components/ui/drawer-or-dialog'
import {AnimatedInputError, Input, Labeled, PasswordInput} from '@/components/ui/input'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {usePassword} from '@/hooks/use-password'
import {useUserName} from '@/hooks/use-user-name'
import {AccountAvatarEditor} from '@/modules/auth/account-avatar-editor'
import {ChangePasswordWarning, useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {SessionsPanel} from '@/routes/settings/sessions'
import {trpcReact} from '@/trpc/trpc'

export function AccountDrawerOrDialog() {
	const {t} = useTranslation()
	const title = t('account')

	const dialogProps = useSettingsDialogProps()
	const {Root, Content, Header, Title, Description, Scroller} = useDrawerOrDialog()
	const navigate = useNavigate()
	const userQ = trpcReact.user.get.useQuery()
	const closeDialog = () => dialogProps.onOpenChange(false)

	const tabs = [
		{id: 'change-name', label: t('name')},
		{id: 'change-password', label: t('password')},
		{id: 'sessions', label: t('active-logins.title')},
	] as const
	type TabId = (typeof tabs)[number]['id']

	const {accountTab} = useParams<{accountTab: TabId}>()
	const activeTab = tabs.some(({id}) => id === accountTab) ? accountTab! : tabs[0].id

	return (
		<Root {...dialogProps}>
			<Content fullHeight>
				<Header>
					<Title>{title}</Title>
					<Description>{t('account-description')}</Description>
				</Header>
				<Scroller>
					{userQ.data && (
						<div className='mb-5 flex items-center gap-4 px-1'>
							<AccountAvatarEditor account={userQ.data} size={72} />
							<div className='min-w-0'>
								<h2 className='text-18 truncate font-semibold -tracking-2 text-white'>{userQ.data.name}</h2>
								<p className='text-13 text-white/40'>{t('users.member')}</p>
							</div>
						</div>
					)}
					<SegmentedControl
						size='lg'
						tabs={tabs}
						value={activeTab}
						onValueChange={(tab) => navigate(`/settings/account/${tab}`, {replace: true})}
					/>
					{activeTab === 'change-name' && <ChangeName closeDialog={closeDialog} />}
					{activeTab === 'change-password' && <ChangePassword closeDialog={closeDialog} />}
					{activeTab === 'sessions' && <SessionsPanel />}
				</Scroller>
			</Content>
		</Root>
	)
}

function ChangeName({closeDialog}: {closeDialog: () => void}) {
	const {t} = useTranslation()
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
					<Button type='submit' size='dialog' variant='primary'>
						{t('confirm')}
					</Button>
					<Button type='button' size='dialog' onClick={closeDialog}>
						{t('cancel')}
					</Button>
				</DrawerFooter>
				<div className='' />
			</fieldset>
		</form>
	)
}

function ChangePassword({closeDialog}: {closeDialog: () => void}) {
	const {t} = useTranslation()
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
			<fieldset disabled={isLoading} className='flex flex-1 flex-col gap-5'>
				<ChangePasswordWarning />
				<Labeled label={t('change-password.current-password')}>
					<PasswordInput value={password} onValueChange={setPassword} error={fieldErrors.oldPassword} />
				</Labeled>
				<Labeled label={t('change-password.new-password')}>
					<PasswordInput value={newPassword} onValueChange={setNewPassword} error={fieldErrors.newPassword} />
				</Labeled>
				<Labeled label={t('change-password.repeat-password')}>
					<PasswordInput value={newPasswordRepeat} onValueChange={setNewPasswordRepeat} />
				</Labeled>
				<div className='flex-1' />
				<div className='-my-2.5'>
					<AnimatedInputError>{formError}</AnimatedInputError>
				</div>

				<DrawerFooter>
					<Button type='submit' size='dialog' variant='primary'>
						{t('confirm')}
					</Button>
					<Button type='button' size='dialog' onClick={closeDialog}>
						{t('cancel')}
					</Button>
				</DrawerFooter>
			</fieldset>
		</form>
	)
}
