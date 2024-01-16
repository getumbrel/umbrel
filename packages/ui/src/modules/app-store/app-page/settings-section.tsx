import {ReactNode} from 'react'

import {CopyableField} from '@/components/ui/copyable-field'
import {Switch} from '@/shadcn-components/ui/switch'
import {trpcReact, UserApp} from '@/trpc/trpc'

import {cardClass, cardTitleClass} from './shared'

export function SettingsSection({userApp}: {userApp: UserApp}) {
	const ctx = trpcReact.useContext()
	const setMut = trpcReact.user.apps.set.useMutation({
		onSuccess: () => ctx.user.apps.invalidate(),
	})

	const handleAutoUpdateChange = (checked: boolean) => {
		setMut.mutate({appId: userApp.id, autoUpdate: checked})
	}

	const handleShowNotifcationsChange = (checked: boolean) => {
		setMut.mutate({appId: userApp.id, showNotifications: checked})
	}

	return (
		<div className={cardClass}>
			<h2 className={cardTitleClass}>App Settings</h2>
			<label>
				<KV
					k='Auto-update'
					v={
						<Switch checked={userApp.autoUpdate} onCheckedChange={handleAutoUpdateChange} disabled={setMut.isLoading} />
					}
				/>
			</label>
			<label>
				<KV
					k='Notifications'
					v={
						<Switch
							checked={userApp.showNotifications}
							onCheckedChange={handleShowNotifcationsChange}
							disabled={setMut.isLoading}
						/>
					}
				/>
			</label>
			<KV
				k='Default username'
				v={<CopyableField className='w-[120px]' narrow value={userApp.credentials.defaultUsername} />}
			/>
			<KV
				k='Default password'
				v={<CopyableField narrow className='w-[120px]' value={userApp.credentials.defaultPassword} isPassword />}
			/>
		</div>
	)
}

function KV({k, v}: {k: ReactNode; v: ReactNode}) {
	return (
		<div className='flex flex-row items-center gap-2'>
			<span className='flex-1 text-15 font-medium -tracking-4'>{k}</span>
			<span className='text-right text-14 font-medium'>{v || 'Unknown'}</span>
		</div>
	)
}
