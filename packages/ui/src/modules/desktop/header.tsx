import UmbrelLogo from '@/assets/umbrel-logo'
import {cn} from '@/shadcn-lib/utils'
import {trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {getPartofDay} from './desktop-misc'

export function Header() {
	const getQuery = trpcReact.user.get.useQuery()

	const name = getQuery.data?.name

	// Always rendering the entire component to avoid layout thrashing
	return (
		<div className={cn('relative z-10', name ? 'duration-300 animate-in fade-in slide-in-from-bottom-8' : 'invisible')}>
			<div className='flex flex-col items-center gap-3 px-4 md:gap-4'>
				<UmbrelLogo
					className='w-[73px] md:w-auto'
					// Need to remove `view-transition-name` because it causes the logo to
					// briefly appear over the sheets between page transitions
					ref={(ref) => {
						ref?.style?.removeProperty('view-transition-name')
					}}
				/>
				<h1 className='text-center text-19 font-bold md:text-5xl'>
					{
						{
							morning: t('desktop.greeting.morning', {name}),
							afternoon: t('desktop.greeting.afternoon', {name}),
							evening: t('desktop.greeting.evening', {name}),
						}[getPartofDay()]
					}
					.
				</h1>
			</div>
		</div>
	)
}
