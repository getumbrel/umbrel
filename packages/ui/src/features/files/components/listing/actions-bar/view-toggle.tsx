import {GridLayoutIcon} from '@/features/files/assets/grid-layout-icon'
import {ListLayoutIcon} from '@/features/files/assets/list-layout-icon'
import {usePreferences} from '@/features/files/hooks/use-preferences'
import {ViewPreferences} from '@/features/files/types'
import {Tabs, TabsList, TabsTrigger} from '@/shadcn-components/ui/tabs'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

export function ViewToggle() {
	const {preferences, setView, isLoading, isError} = usePreferences()

	const viewModes: ViewPreferences['view'][] = ['icons', 'list']

	const {view} = preferences ?? {view: 'list'}

	return (
		// Hide the view toggle while loading preferences or if there's an error
		<Tabs
			value={view}
			onValueChange={(value) => setView(value as ViewPreferences['view'])}
			className={cn(isLoading || (isError && 'opacity-0'))}
		>
			<TabsList className='h-7 rounded-full border-[0.5px] border-white/6 bg-white/6 px-0.5 py-0 shadow-button-highlight-soft-hpx ring-white/6 hover:bg-white/10 data-[state=open]:bg-white/10'>
				{viewModes.map((mode) => (
					<TabsTrigger
						key={mode}
						value={mode}
						className={cn('h-6 rounded-full', view === mode && 'bg-brand')}
						aria-label={t(`files-view.${mode}`)}
					>
						{mode === 'icons' ? (
							<GridLayoutIcon className={cn('h-4 w-4', view === mode ? 'text-white' : 'text-white/50')} />
						) : (
							<ListLayoutIcon className={cn('h-4 w-4', view === mode ? 'text-white' : 'text-white/50')} />
						)}
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	)
}
