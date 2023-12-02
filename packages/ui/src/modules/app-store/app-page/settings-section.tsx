import {ReactNode} from 'react'

import {CopyableField} from '@/components/ui/copyable-field'
import {Switch} from '@/shadcn-components/ui/switch'
import {InstalledApp} from '@/trpc/trpc'

import {cardClass, cardTitleClass} from './shared'

export function SettingsSection({installedApp}: {installedApp: InstalledApp}) {
	const defaultUsername = 'umbrel'
	const defaultPassword = 'beef38f0a3f76510d8f24e259c5c3da8c4e245bd468afdd0eabfe86a4f7813e'

	return (
		<div className={cardClass}>
			<h2 className={cardTitleClass}>App Settings</h2>
			<label>
				<KV k='Auto-update' v={<Switch checked={installedApp.autoUpdate} />} />
			</label>
			<label>
				<KV k='Notifications' v={<Switch checked={installedApp.showNotifications} />} />
			</label>
			<KV k='Default username' v={<CopyableField className='w-[120px]' narrow value={defaultUsername} />} />
			<KV k='Default password' v={<CopyableField narrow className='w-[120px]' value={defaultPassword} isPassword />} />
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
