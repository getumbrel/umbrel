import {useNavigate} from 'react-router-dom'
import {useInterval} from 'react-use'

import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {MigrateInner} from '@/modules/migrate/migrate-inner'
import {trpcReact} from '@/trpc/trpc'

export default function Migrate() {
	const navigate = useNavigate()

	const migrationStatusQ = trpcReact.migration.migrationStatus.useQuery()

	useInterval(migrationStatusQ.refetch, 500)

	const {running, progress, error, description} = migrationStatusQ.data ?? {}

	const message = (description || 'Connecting') + '...'
	useUmbrelTitle(message)

	if (error) {
		navigate('/migrate/failed')
	}

	if (!running && progress === 100) {
		navigate('/migrate/success')
	}

	return <MigrateInner progress={progress} message={message} isRunning={!!running} />
}
