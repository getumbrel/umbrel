import {Link} from 'react-router-dom'

import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass} from '@/layouts/bare/shared'
import {bareContainerClass, BareLogoTitle, BareSpacer, bareTextClass} from '@/modules/bare/shared'
import {cn} from '@/shadcn-lib/utils'

import {factoryResetTitle} from './misc'

// TODO: start using when necessary
export function Success() {
	const title = 'Reset successful!'
	useUmbrelTitle(factoryResetTitle(title))
	return (
		<div className={bareContainerClass}>
			<BareLogoTitle>{title}</BareLogoTitle>
			<p className={cn(bareTextClass, 'w-[80%] sm:w-[55%]')}>
				All your apps, app data, and account details have been deleted from your device. Restart to start from scratch.
			</p>
			<BareSpacer />
			<Link to='/restart' className={buttonClass}>
				Restart device
			</Link>
		</div>
	)
}
