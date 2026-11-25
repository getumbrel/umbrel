import {useTranslation} from 'react-i18next'

import {Cover, CoverRetryActions} from '@/components/ui/cover'
import {trpcReact} from '@/trpc/trpc'

export function useMigrate({onMutate, onSuccess}: {onMutate?: () => void; onSuccess?: (didWork: boolean) => void}) {
	const migrateMut = trpcReact.migration.migrate.useMutation({
		onMutate,
		onSuccess,
	})

	const migrate = () => migrateMut.mutate()

	return migrate
}

export function MigratingCover({onRetry}: {onRetry: () => void}) {
	const {t} = useTranslation()
	const updateStatusQ = trpcReact.migration.migrationStatus.useQuery(undefined, {
		refetchInterval: 500,
	})

	const {progress, description, running, error} = updateStatusQ.data ?? {}
	const indeterminate = updateStatusQ.isLoading || !running

	if (error) {
		return (
			<Cover
				mark='warning'
				title={t('migrate.failed.title')}
				description={error}
				actions={<CoverRetryActions retry={t('migrate.failed.retry')} onRetry={onRetry} />}
			/>
		)
	}

	// There is no cover for success: umbrelOS goes straight to rebooting
	return (
		<Cover
			title={t('migration-assistant')}
			progress={indeterminate ? 'indeterminate' : (progress ?? 'indeterminate')}
			// An empty step gets the default too
			status={description || t('connecting')}
			note={t('migrate.callout')}
		/>
	)
}

export function useSoftwareUpdate({
	onMutate,
	onSuccess,
}: {
	onMutate?: () => void
	onSuccess?: (didWork: boolean) => void
}) {
	const updateVersionMut = trpcReact.update.install.useMutation({
		onMutate,
		onSuccess,
	})

	const update = () => updateVersionMut.mutate()

	return update
}
