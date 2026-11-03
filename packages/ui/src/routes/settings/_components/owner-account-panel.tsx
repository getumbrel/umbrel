import {useTranslation} from 'react-i18next'
import {TbChevronRight} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {DialogFooter} from '@/components/ui/dialog'
import {AnimatedInputError, Input, PasswordInput} from '@/components/ui/input'
import {listClass} from '@/components/ui/list'
import {Switch} from '@/components/ui/switch'
import {usePassword} from '@/hooks/use-password'
import {useUserName} from '@/hooks/use-user-name'
import {cn} from '@/lib/utils'
import {AccountAvatar} from '@/modules/auth/account-avatar'
import {AccountAvatarEditor} from '@/modules/auth/account-avatar-editor'
import {BackButton, ChangePasswordWarning} from '@/routes/settings/_components/shared'
import {SessionsPanel} from '@/routes/settings/sessions'
import {RouterOutput, trpcReact} from '@/trpc/trpc'

type Account = RouterOutput['user']['listAccounts'][number]

export type OwnerPanel = 'overview' | 'name' | 'password' | 'sessions'

export function OwnerAccountPanel({
	owner,
	panel,
	onBack,
	onPanelChange,
}: {
	owner: Account
	panel: OwnerPanel
	onBack: () => void
	onPanelChange: (panel: OwnerPanel) => void
}) {
	if (panel === 'sessions') {
		return <SessionsPanel onBack={() => onPanelChange('overview')} backLabel={owner.name} />
	}

	if (panel === 'name') {
		return (
			<OwnerNamePanel
				owner={owner}
				onBack={() => onPanelChange('overview')}
				onSuccess={() => onPanelChange('overview')}
			/>
		)
	}

	if (panel === 'password') {
		return (
			<OwnerPasswordPanel
				owner={owner}
				onBack={() => onPanelChange('overview')}
				onSuccess={() => onPanelChange('overview')}
			/>
		)
	}

	return <OwnerAccountOverview owner={owner} onBack={onBack} onPanelChange={onPanelChange} />
}

function OwnerAccountOverview({
	owner,
	onBack,
	onPanelChange,
}: {
	owner: Account
	onBack: () => void
	onPanelChange: (panel: OwnerPanel) => void
}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const is2faEnabledQ = trpcReact.user.is2faEnabled.useQuery()

	return (
		<div className='flex flex-col gap-5'>
			<OwnerPanelHeader owner={owner} onBack={onBack} editableAvatar />
			<div className={listClass}>
				<OwnerNavigationRow title={t('change-name')} description={owner.name} onClick={() => onPanelChange('name')} />
				<OwnerNavigationRow
					title={t('change-password')}
					description={t('change-password.description')}
					onClick={() => onPanelChange('password')}
				/>
				<div className='flex min-h-[58px] items-center gap-3 px-3 py-2.5'>
					<div className='min-w-0 flex-1'>
						<div className='text-14 font-medium -tracking-2 text-white/90'>{t('2fa')}</div>
						<div className='mt-0.5 text-12 leading-tight text-white/40'>{t('2fa-description')}</div>
					</div>
					<Switch
						aria-label={t('2fa')}
						checked={!!is2faEnabledQ.data}
						disabled={is2faEnabledQ.isLoading}
						onCheckedChange={() =>
							navigate('/settings/2fa', {
								state: {settingsReturnTo: '/settings/users?ownerPanel=overview'},
							})
						}
					/>
				</div>
				<OwnerNavigationRow
					title={t('active-logins.title')}
					description={t('active-logins.description')}
					onClick={() => onPanelChange('sessions')}
				/>
			</div>
		</div>
	)
}

function OwnerPanelHeader({
	owner,
	onBack,
	title = owner.name,
	description,
	backLabel,
	editableAvatar = false,
}: {
	owner: Account
	onBack: () => void
	title?: string
	description?: string
	backLabel?: string
	editableAvatar?: boolean
}) {
	const {t} = useTranslation()

	return (
		<div className='flex flex-col gap-3'>
			<BackButton onClick={onBack}>{backLabel ?? t('users')}</BackButton>
			<div className={cn('flex items-center pt-2', editableAvatar ? 'gap-4' : 'gap-3')}>
				{editableAvatar ? (
					<AccountAvatarEditor account={owner} size={72} controlsOffset='overlap' />
				) : (
					<AccountAvatar name={owner.name} userId={owner.userId} avatarUrl={owner.avatarUrl} size={40} />
				)}
				<div className='min-w-0 flex-1'>
					<h2 className={cn('truncate leading-snug font-semibold -tracking-2', editableAvatar ? 'text-20' : 'text-15')}>
						{title}
					</h2>
					<p
						className={cn(
							'leading-normal tracking-normal text-white/40 opacity-100',
							editableAvatar ? 'text-13' : 'text-12',
						)}
					>
						{description ?? t('users.owner')}
					</p>
				</div>
			</div>
		</div>
	)
}
function OwnerNavigationRow({title, description, onClick}: {title: string; description?: string; onClick: () => void}) {
	return (
		<button
			type='button'
			className={cn(
				'group flex min-h-[58px] w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/4',
				'outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
				'first:rounded-t-12 last:rounded-b-12',
			)}
			onClick={onClick}
		>
			<div className='min-w-0 flex-1'>
				<div className='text-14 font-medium -tracking-2 text-white/90'>{title}</div>
				{description && <div className='mt-0.5 truncate text-12 leading-tight text-white/40'>{description}</div>}
			</div>
			<TbChevronRight className='size-4 shrink-0 text-white/20 transition-transform group-hover:translate-x-0.5' />
		</button>
	)
}

function OwnerNamePanel({owner, onBack, onSuccess}: {owner: Account; onBack: () => void; onSuccess: () => void}) {
	const {t} = useTranslation()
	const {name, setName, handleSubmit, formError, isLoading} = useUserName({onSuccess})

	return (
		<form onSubmit={handleSubmit} className='flex flex-col gap-5'>
			<OwnerPanelHeader
				owner={owner}
				onBack={onBack}
				title={t('change-name')}
				description={t('account')}
				backLabel={owner.name}
			/>
			<fieldset disabled={isLoading} className='flex flex-col gap-4'>
				<Input autoFocus placeholder={t('change-name.input-placeholder')} value={name} onValueChange={setName} />
				<AnimatedInputError>{formError}</AnimatedInputError>
				<FormActions onCancel={onBack} />
			</fieldset>
		</form>
	)
}

function OwnerPasswordPanel({owner, onBack, onSuccess}: {owner: Account; onBack: () => void; onSuccess: () => void}) {
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
	} = usePassword({onSuccess})

	return (
		<form onSubmit={handleSubmit} className='flex flex-col gap-5'>
			<OwnerPanelHeader
				owner={owner}
				onBack={onBack}
				title={t('change-password')}
				description={t('account')}
				backLabel={owner.name}
			/>
			<fieldset disabled={isLoading} className='flex flex-col gap-4'>
				<ChangePasswordWarning />
				<PasswordInput
					autoFocus
					label={t('change-password.current-password')}
					value={password}
					onValueChange={setPassword}
					error={fieldErrors.oldPassword}
				/>
				<PasswordInput
					label={t('change-password.new-password')}
					value={newPassword}
					onValueChange={setNewPassword}
					error={fieldErrors.newPassword}
				/>
				<PasswordInput
					label={t('change-password.repeat-password')}
					value={newPasswordRepeat}
					onValueChange={setNewPasswordRepeat}
				/>
				<AnimatedInputError>{formError}</AnimatedInputError>
				<FormActions onCancel={onBack} />
			</fieldset>
		</form>
	)
}

function FormActions({onCancel}: {onCancel: () => void}) {
	const {t} = useTranslation()
	return (
		<DialogFooter>
			<Button type='submit' size='dialog' variant='primary'>
				{t('confirm')}
			</Button>
			<Button type='button' size='dialog' onClick={onCancel}>
				{t('cancel')}
			</Button>
		</DialogFooter>
	)
}
