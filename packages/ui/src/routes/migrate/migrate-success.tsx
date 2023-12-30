import {Link} from 'react-router-dom'

import {useUmbrelTitle} from '@/hooks/use-umbrel-title'
import {buttonClass} from '@/layouts/bare/shared'
import {bareContainerClass, BareLogoTitle, BareSpacer, bareTextClass} from '@/modules/bare/shared'
import {cn} from '@/shadcn-lib/utils'

export default function MigrateSuccess() {
	useUmbrelTitle('Migration successful')

	return (
		<div className={cn(bareContainerClass, 'h-auto w-auto duration-1000 animate-in fade-in zoom-in-95')}>
			<BareLogoTitle>Migration successful!</BareLogoTitle>
			<p className={cn(bareTextClass, 'w-[80%] sm:w-[55%]')}>
				All your apps, app data, and account details have been migrated to your Umbrel Home.
			</p>
			<BareSpacer />
			<Link to='/' className={buttonClass}>
				Continue to log in
			</Link>
		</div>
	)
}
