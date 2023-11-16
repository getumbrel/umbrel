import {Link} from 'react-router-dom'

import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass} from '@/layouts/bare/shared'
import {cn} from '@/shadcn-lib/utils'

import {migrateContainerClass, migrateTextClass, migrateTitleClass} from './_shared'

export default function MigrateFailed() {
	useUmbrelTitle('Migration failed')

	return (
		<div className={cn(migrateContainerClass, 'animate-in slide-in-from-bottom-2')}>
			<h1 className={migrateTitleClass}>Migration failed.</h1>
			<div className='pt-1' />
			<p className={migrateTextClass}>
				There was an error during migration.
				<br />
				Please try again.
			</p>
			<div className='pt-[50px]' />
			<Link to='/migrate' className={buttonClass}>
				Retry migration
			</Link>
		</div>
	)
}
