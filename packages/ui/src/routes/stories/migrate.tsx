import {toast} from 'sonner'

import {useDemoMigrateProgress} from '@/hooks/use-demo-progress'

import {MigrateInner} from '../migrate'

export function MigrateStory() {
	return (
		<>
			<MigrateStory1 />
			<MigrateStory2 />
		</>
	)
}

export function MigrateStory1() {
	return <MigrateInner progress={0} message='Starting...' isRunning={false} />
}

export function MigrateStory2() {
	const {progress} = useDemoMigrateProgress({
		onSuccess: () => {
			toast.success('Migration successful')
		},
		onFail: () => {
			toast.error('Migration failed')
		},
	})

	return <MigrateInner progress={progress} message='Migrating...' isRunning={true} />
}
