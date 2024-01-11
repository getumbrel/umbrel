import {useState} from 'react'

import {SegmentedControl} from '@/components/ui/segmented-control'
import {usePassword} from '@/hooks/use-password'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {useUserName} from '@/hooks/use-user-name'
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
import {useDialogOpenProps} from '@/utils/dialog'

import {NoForgotPasswordMessage} from '../no-forgot-password-message'

export function AccountDrawer() {
	const title = 'Account'
	useUmbrelTitle(title)

	const dialogProps = useDialogOpenProps('account')
	const closeDialog = () => dialogProps.onOpenChange(false)

	const tabs = [
		{id: 'change-name', label: 'Display name'},
		{id: 'change-password', label: 'Password'},
	]
	const [activeTab, setActiveTab] = useState(tabs[0].id)

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>Your display name & Umbrel password</DrawerDescription>
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
				<Labeled label='Display name'>
					<Input value={name} onValueChange={setName} />
				</Labeled>
				<div className='-my-2.5'>
					<AnimatedInputError>{formError}</AnimatedInputError>
				</div>
				<div className='flex-1' />
				<DrawerFooter>
					<Button type='button' size='dialog' onClick={closeDialog}>
						Cancel
					</Button>
					<Button type='submit' size='dialog' variant='primary'>
						Save changes
					</Button>
				</DrawerFooter>
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
				{/* <div className='umbrel-fade-scroller-y flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto'> */}
				<Labeled label='Current password'>
					<PasswordInput value={password} onValueChange={setPassword} />
				</Labeled>
				<Labeled label='New password'>
					<PasswordInput value={newPassword} onValueChange={setNewPassword} error={fieldErrors.oldPassword} />
				</Labeled>
				<Labeled label='Repeat password'>
					<PasswordInput
						value={newPasswordRepeat}
						onValueChange={setNewPasswordRepeat}
						error={fieldErrors.newPassword}
					/>
				</Labeled>
				<NoForgotPasswordMessage />
				<div className='flex-1' />
				<div className='-my-2.5'>
					<AnimatedInputError>{formError}</AnimatedInputError>
				</div>

				<DrawerFooter>
					<Button type='button' size='dialog' onClick={closeDialog}>
						Cancel
					</Button>
					<Button type='submit' size='dialog' variant='primary'>
						Save changes
					</Button>
				</DrawerFooter>
				{/* </div> */}
			</fieldset>
		</form>
	)
}
