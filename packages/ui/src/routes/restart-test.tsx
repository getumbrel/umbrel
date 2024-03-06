import {JSONTree} from 'react-json-tree'

import {toast} from '@/components/ui/toast'
import {Button} from '@/shadcn-components/ui/button'
import {trpcReact} from '@/trpc/trpc'

import {useShutdownRestartPolling} from '../hooks/use-shutdown-restart-polling'

export default function RestartTest() {
	const {state, startExpectingFailure, canManualPing, manualPing, pingQ} = useShutdownRestartPolling()

	const restartMut = trpcReact.system.reboot.useMutation({
		onSuccess: () => startExpectingFailure(),
		onError: (error) => toast(error.message),
	})

	return (
		<div>
			{state === 'initial' && <Button onClick={() => restartMut.mutate()}>Restart</Button>}
			{canManualPing && <Button onClick={manualPing}>Ping backend now</Button>}
			<JSONTree data={{state, pingQ}} />
		</div>
	)
}
