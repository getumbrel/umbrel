import {Link} from 'react-router-dom'

import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass} from '@/layouts/bare/shared'
import {bareContainerClass, BareSpacer, bareTextClass, bareTitleClass} from '@/modules/bare/shared'
import {cn} from '@/shadcn-lib/utils'

export default function MigrateFailed() {
	useUmbrelTitle('Migration failed')

	return (
		<div className={cn(bareContainerClass, 'animate-in slide-in-from-bottom-2')}>
			<h1 className={bareTitleClass}>Migration failed.</h1>
			<div className='pt-1' />
			<p className={bareTextClass}>
				There was an error during migration.
				<br />
				Please try again.
			</p>
			<BareSpacer />
			<Link to='/migrate' className={buttonClass}>
				Retry migration
			</Link>
		</div>
	)
}
