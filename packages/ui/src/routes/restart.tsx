import {useNavigate} from 'react-router-dom'
import {useEffectOnce} from 'react-use'

import {CoverMessage, CoverMessageParagraph} from '@/components/ui/cover-message'
import {Loading} from '@/components/ui/loading'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {Button} from '@/shadcn-components/ui/button'
import {trpcReact} from '@/trpc/trpc'

export default function Restart() {
	const navigate = useNavigate()
	useUmbrelTitle('Restarting...')

	const restartMut = trpcReact.system.reboot.useMutation({
		onSuccess: () => navigate('/'),
	})

	useEffectOnce(() => {
		// Start restart
		restartMut.mutate()
	})

	if (restartMut.isError) {
		return (
			<CoverMessage>
				Failed to restart.
				<Button size='sm' className='inline' onClick={() => restartMut.mutate()}>
					Try Again
				</Button>
			</CoverMessage>
		)
	}

	return (
		<CoverMessage>
			<Loading>Restarting</Loading>
			<CoverMessageParagraph>
				Please do not refresh this page or turn off your Umbrel while it is restarting.
			</CoverMessageParagraph>
		</CoverMessage>
	)
}
