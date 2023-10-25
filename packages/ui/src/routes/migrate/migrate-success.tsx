import {Link} from 'react-router-dom'

import UmbrelLogo from '@/assets/umbrel-logo'
import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass} from '@/layouts/bare/shared'
import {cn} from '@/shadcn-lib/utils'

import {migrateContainerClass, migrateTextClass, migrateTitleClass} from './_shared'

export function MigrateSuccess() {
	useUmbrelTitle('Migration successful')

	return (
		<div className={cn(migrateContainerClass, 'h-auto w-auto duration-1000 animate-in fade-in zoom-in-95')}>
			<UmbrelLogo />
			<div className='pt-4' />
			<h1 className={migrateTitleClass}>Migration successful!</h1>
			<p className={cn(migrateTextClass, 'w-[80%] sm:w-[55%]')}>
				All your apps, app data, and account details have been migrated to your Umbrel Home.
			</p>
			<div className='pt-[50px]' />
			<Link to='/' className={buttonClass}>
				Continue to log in
			</Link>
		</div>
	)
}
