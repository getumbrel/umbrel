import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import FailedLayout from '@/modules/bare/failed-layout'

import {factoryResetTitle} from './misc'

export function Failed() {
	const title = 'Reset failed'
	useUmbrelTitle(factoryResetTitle(title))

	return (
		<FailedLayout
			title={title}
			description={
				<>
					There was an error during reset.
					<br />
					Please try again.
				</>
			}
			buttonText='Retry factory reset'
			to='/factory-reset'
		/>
	)
}
