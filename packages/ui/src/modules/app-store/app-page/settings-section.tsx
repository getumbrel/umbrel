import {ReactNode} from 'react'
import {toast} from 'sonner'

import {CopyableField} from '@/components/ui/copyable-field'
import {UNKNOWN} from '@/constants'
import {Switch} from '@/shadcn-components/ui/switch'
import {trpcReact, UserApp} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {cardClass, cardTitleClass} from './shared'

export function SettingsSection({userApp}: {userApp: UserApp}) {
	const ctx = trpcReact.useContext()

	// @ts-expect-error `autoUpdate`
	const autoUpdateMut = trpcReact.apps.autoUpdate.useMutation({
		onSuccess: () => ctx.apps.invalidate(),
	})

	// @ts-expect-error `showNotifications`
	const showNotificationsMut = trpcReact.apps.showNotifications.useMutation({
		onSuccess: () => ctx.apps.invalidate(),
	})

	const handleAutoUpdateChange = (checked: boolean) => {
		// TODO: use mutation
		toast(`Auto-update to ${checked} setting is not available yet`)
		autoUpdateMut.mutate({appId: userApp.id, autoUpdate: checked})
	}

	const handleShowNotifcationsChange = (checked: boolean) => {
		// TODO: use mutation
		toast(`Notifications setting to ${checked} is not available yet`)
		showNotificationsMut.mutate({appId: userApp.id, showNotifications: checked})
	}

	return (
		<div className={cardClass}>
			<h2 className={cardTitleClass}>{t('app-page.section.settings.title')}</h2>
			<label>
				<KV
					k={t('auto-update')}
					v={
						<Switch
							checked={userApp.autoUpdate}
							onCheckedChange={handleAutoUpdateChange}
							disabled={autoUpdateMut.isLoading}
						/>
					}
				/>
			</label>
			<label>
				<KV
					k={t('notifications')}
					v={
						<Switch
							checked={userApp.showNotifications}
							onCheckedChange={handleShowNotifcationsChange}
							disabled={showNotificationsMut.isLoading}
						/>
					}
				/>
			</label>
			<KV
				k={t('default-credentials.username')}
				v={<CopyableField className='w-[120px]' narrow value={userApp.credentials.defaultUsername} />}
			/>
			<KV
				k={t('default-credentials.password')}
				v={<CopyableField narrow className='w-[120px]' value={userApp.credentials.defaultPassword} isPassword />}
			/>
		</div>
	)
}

function KV({k, v}: {k: ReactNode; v: ReactNode}) {
	return (
		<div className='flex flex-row items-center gap-2'>
			<span className='flex-1 truncate whitespace-nowrap text-15 font-medium -tracking-4'>{k}</span>
			<span className='text-right text-14 font-medium'>{v || UNKNOWN()}</span>
		</div>
	)
}
