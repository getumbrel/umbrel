import {BarePage} from '@/layouts/bare/bare-page'
import FailedLayout from '@/modules/bare/failed-layout'
import {ProgressLayout} from '@/modules/bare/progress-layout'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

export function useMigrate({onMutate, onSuccess}: {onMutate?: () => void; onSuccess?: (didWork: boolean) => void}) {
	const migrateMut = trpcReact.migration.migrate.useMutation({
		onMutate,
		onSuccess,
	})

	const migrate = () => migrateMut.mutate()

	return migrate
}

export function MigratingCover({onRetry}: {onRetry: () => void}) {
	const updateStatusQ = trpcReact.migration.migrationStatus.useQuery(undefined, {
		refetchInterval: 500,
	})

	const {progress, description, running, error} = updateStatusQ.data ?? {}
	const indeterminate = updateStatusQ.isLoading || !running

	return (
		<BarePage>
			{!error && (
				<ProgressLayout
					title={t('migration-assistant')}
					callout={t('migrate.callout')}
					progress={indeterminate ? undefined : progress}
					message={description}
					isRunning={!!running}
				/>
			)}
			{error && (
				<FailedLayout
					title={t('migrate.failed.title')}
					description={<>Error: {error}</>}
					buttonText={t('migrate.failed.retry')}
					buttonOnClick={onRetry}
				/>
			)}
			{/* We go straight to rebooting */}
			{/* {progress === 100 && (
				<SuccessLayout
					title={t('migrate.success.title')}
					description={t('migrate.success.description')}
					buttonText={t('continue-to-log-in')}
				/>
			)} */}
		</BarePage>
	)
}

export function useSoftwareUpdate({
	onMutate,
	onSuccess,
}: {
	onMutate?: () => void
	onSuccess?: (didWork: boolean) => void
}) {
	const updateVersionMut = trpcReact.system.update.useMutation({
		onMutate,
		onSuccess,
	})

	const update = () => updateVersionMut.mutate()

	return update
}
