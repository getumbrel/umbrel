import {useTranslation} from 'react-i18next'

import {AppStoreEmptyState} from '@/features/app-store/components/app-grid'
import {SectionHeading} from '@/features/app-store/components/section-heading'
import {VirtualAppGrid} from '@/features/app-store/components/virtual-app-grid'
import {storeRevealClass, storeRevealDelay} from '@/features/app-store/constants'
import {createAppStoreSearch} from '@/features/app-store/data/search'
import {useAppStatusMap} from '@/features/app-store/hooks/use-app-status'
import {cn} from '@/lib/utils'
import {useAvailableApps} from '@/providers/available-apps'

// Search is local and instant: registry fields only, no network requests.
export function SearchResults({query}: {query: string}) {
	const {t} = useTranslation()
	const {apps, isLoading} = useAvailableApps()
	const statuses = useAppStatusMap()

	if (isLoading) return null

	const search = createAppStoreSearch(apps ?? [])
	const results = search(query)

	// Results sit directly on the sheet like category pages — no card container
	return (
		<div className='flex flex-col gap-4'>
			<div className={cn('px-2.5 md:px-0', storeRevealClass)}>
				<SectionHeading
					title={
						<>
							<span className='opacity-50'>{t('app-store.search.results-for')}</span> {query}
						</>
					}
					// No count beside the empty state, which already says there are no results
					rightChildren={
						results.length > 0 && (
							<span className='text-13 whitespace-nowrap text-white/40'>
								{t('app-store.search.result-count', {count: results.length})}
							</span>
						)
					}
				/>
			</div>
			{results.length > 0 ? (
				<VirtualAppGrid apps={results} statuses={statuses} revealDelayStart={60} />
			) : (
				<div className={storeRevealClass} style={storeRevealDelay(60)}>
					<AppStoreEmptyState
						title={t('app-store.search.no-results')}
						description={t('app-store.search.no-results-description')}
					/>
				</div>
			)}
		</div>
	)
}
