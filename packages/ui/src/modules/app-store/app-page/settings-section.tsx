import {ReactNode} from 'react'

import {CopyableField} from '@/components/ui/copyable-field'
import {UNKNOWN} from '@/constants'
import {trpcReact, UserApp} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {cardClass, cardTitleClass} from './shared'

export function SettingsSection({userApp}: {userApp: UserApp}) {
	const ctx = trpcReact.useContext()

	return (
		<div className={cardClass}>
			<h2 className={cardTitleClass}>{t('app-page.section.settings.title')}</h2>
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
