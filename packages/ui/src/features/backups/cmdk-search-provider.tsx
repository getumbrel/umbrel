import {useNavigate} from 'react-router-dom'

import {CmdkSearchProviderProps} from '@/components/cmdk-providers'
import backupsIcon from '@/features/backups/assets/backups-icon.png'
import {useBackups} from '@/features/backups/hooks/use-backups'
import {CommandItem} from '@/shadcn-components/ui/command'
import {t} from '@/utils/i18n'

export const BackupsCmdkSearchProvider: React.FC<CmdkSearchProviderProps> = ({close}) => {
	const navigate = useNavigate()
	const {repositories} = useBackups()

	// Determine if we have existing repositories
	const hasExistingRepositories = (repositories?.length ?? 0) > 0

	// Navigate to the appropriate route based on whether repositories exist
	const handleSelect = () => {
		const route = hasExistingRepositories ? '/settings/backups/configure' : '/settings/backups/setup'
		navigate(route, {preventScrollReset: true})
		close()
	}

	// Render the appropriate command item
	return (
		<CommandItem
			icon={<img src={backupsIcon} alt='Backups' className='size-full' />}
			value='backup-settings'
			onSelect={handleSelect}
		>
			<span>
				{t('backups')}{' '}
				<span className='opacity-50'>
					{t('generic-in')} {t('settings')}
				</span>
			</span>
		</CommandItem>
	)
}
