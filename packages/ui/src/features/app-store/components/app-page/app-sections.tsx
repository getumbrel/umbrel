import {ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {HiExternalLink} from 'react-icons/hi'
import {TbCircleCheckFilled} from 'react-icons/tb'
import {Link} from 'react-router-dom'
import {arrayIncludes} from 'ts-extras'

import {AppIcon} from '@/components/app-icon'
import {CopyableField} from '@/components/ui/copyable-field'
import {registryAppPath} from '@/constants/app-store'
import {resolveDependencyRegistryApp} from '@/lib/app-store-registry'
import {cn} from '@/lib/utils'
import {getAppsImplementingDependency} from '@/modules/app-store/dependency-alternatives'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import {installedStates, RegistryApp, UserApp} from '@/trpc/trpc'

import {appPageSectionLabelClass, ReadMoreMarkdownSection} from './shared'

/**
 * Horizontal band of app facts below the gallery: version, compatibility,
 * source, attribution, and support — the page's reference row, closed off by
 * a hairline. On desktop it spans the full content width with the leftover
 * space distributed evenly between items (apps.umbrel.com style); on smaller
 * screens it falls back to a 3-column, then 2-column grid.
 */
export function InfoBand({app}: {app: RegistryApp}) {
	const {t} = useTranslation()

	return (
		<section className='grid grid-cols-2 gap-x-8 gap-y-5 border-b border-white/10 px-2.5 pb-6 md:grid-cols-3 md:px-0 md:pb-7 lg:flex lg:justify-between'>
			<BandItem label={t('app-page.section.info.version')} value={app.version} />
			<BandItem
				label={t('app-page.section.info.compatibility')}
				value={
					app.compatible ? (
						t('app-page.section.info.compatibility-compatible')
					) : (
						<span className='text-amber-300/80'>{t('app-page.section.info.compatibility-not-compatible')}</span>
					)
				}
			/>
			{app.repo && (
				<BandItem
					label={t('app-page.section.info.source-code')}
					value={<BandLink href={app.repo}>{t('app-page.section.info.source-code.public')}</BandLink>}
				/>
			)}
			<BandItem
				label={t('app-page.section.info.developer')}
				value={<BandLink href={app.website}>{app.developer}</BandLink>}
			/>
			{app.submission && app.submitter && (
				<BandItem
					label={t('app-page.section.info.submitted-by')}
					value={<BandLink href={app.submission}>{app.submitter}</BandLink>}
				/>
			)}
			<BandItem
				label={t('app-store.info.support')}
				value={<BandLink href={app.support}>{t('app-page.section.info.support')}</BandLink>}
			/>
		</section>
	)
}

function BandItem({label, value}: {label: ReactNode; value: ReactNode}) {
	return (
		<div className='flex min-w-0 flex-col gap-1.5'>
			<span className='text-12 leading-tight font-medium text-white/50'>{label}</span>
			<span className='truncate text-14 font-medium'>{value}</span>
		</div>
	)
}

// White external link with a dotted underline and the inline external-link
// glyph (faded until hover), mirroring the home screen's shortcut labels
function BandLink({href, children}: {href: string; children: ReactNode}) {
	return (
		<a
			href={href}
			target='_blank'
			rel='noreferrer'
			className='group underline decoration-white/30 decoration-dotted underline-offset-4 outline-hidden transition-colors hover:decoration-white/60 focus-visible:decoration-white/60'
		>
			{children}
			<HiExternalLink className='ml-1 inline h-3.5 w-3.5 align-[-0.18em] text-white/50 transition-colors group-hover:text-white' />
		</a>
	)
}

// The description flows directly on the sheet, headed by the same muted
// label as the "What's new" timeline alongside it
export function AboutSection({app}: {app: RegistryApp}) {
	const {t} = useTranslation()
	return (
		<div className='flex flex-col gap-2.5'>
			<h2 className={cn(appPageSectionLabelClass, 'mb-1.5')}>{t('app-page.section.about')}</h2>
			{/* Key resets the read-more state when the content changes */}
			<ReadMoreMarkdownSection key={app.description} lines={11}>
				{app.description}
			</ReadMoreMarkdownSection>
		</div>
	)
}

export function CredentialsSection({userApp}: {userApp: UserApp}) {
	const {t} = useTranslation()
	if (!userApp.credentials) return null

	const {defaultUsername, defaultPassword} = userApp.credentials
	if (!defaultUsername && !defaultPassword) return null

	return (
		<section className='flex flex-col gap-3'>
			<h2 className={appPageSectionLabelClass}>{t('app-page.section.credentials.title')}</h2>
			{/* Wide enough for most usernames and passwords, an email address included,
			    and only narrower when the column is */}
			{defaultUsername && (
				<CredentialsRow label={t('default-credentials.username')}>
					<CopyableField className='w-60 min-w-0' narrow value={defaultUsername} />
				</CredentialsRow>
			)}
			{defaultPassword && (
				<CredentialsRow label={t('default-credentials.password')}>
					<CopyableField narrow className='w-60 min-w-0' value={defaultPassword} isPassword />
				</CredentialsRow>
			)}
		</section>
	)
}

function CredentialsRow({label, children}: {label: ReactNode; children: ReactNode}) {
	return (
		<div className='flex flex-row items-center gap-2'>
			<span className='flex-1 text-14 opacity-50'>{label}</span>
			{children}
		</div>
	)
}

export function DependenciesSection({
	app,
	registryId = app.appStoreId,
	showDependencies,
	makeAppPath = registryAppPath,
}: {
	app: RegistryApp
	registryId?: string
	showDependencies?: (dependencyId?: string) => void
	makeAppPath?: (app: RegistryApp) => string
}) {
	const {t} = useTranslation()
	const availableApps = useAllAvailableApps()
	const {userAppsKeyed, isLoading: isLoadingUserApps} = useApps()

	if (availableApps.isLoading || isLoadingUserApps) return null
	const {apps, ambiguousAppIds, repoAppsKeyed} = availableApps

	return (
		<section className='flex flex-col gap-3'>
			<h2 className={appPageSectionLabelClass}>{t('app-page.section.requires')}</h2>
			{app.dependencies?.map((dependencyId) => {
				const dependencyRegistryApp = resolveDependencyRegistryApp({
					dependencyId,
					registryId,
					repoAppsKeyed,
					ambiguousAppIds,
				})
				const dependencyApp = ambiguousAppIds?.has(dependencyId)
					? undefined
					: (dependencyRegistryApp ?? userAppsKeyed?.[dependencyId])
				if (!dependencyApp) {
					return (
						<div key={dependencyId} className='flex w-full min-w-0 flex-col'>
							<h3 className='truncate text-14 leading-tight font-semibold -tracking-3'>{dependencyId}</h3>
							<span className='text-12 text-white/40'>{t('app-store.dependency-metadata-unavailable')}</span>
						</div>
					)
				}
				const dependencyPath = dependencyRegistryApp ? makeAppPath(dependencyRegistryApp) : undefined
				const dependencyUserApp = userAppsKeyed?.[dependencyId]
				const numberOfAlternatives = getAppsImplementingDependency(
					apps,
					userAppsKeyed,
					dependencyId,
					ambiguousAppIds,
				).length
				const installed = !!dependencyUserApp && arrayIncludes(installedStates, dependencyUserApp.state)
				const alternativesLabel = t('app-page.section.dependencies.n-alternatives', {
					count: numberOfAlternatives + /* the app itself */ 1,
				})

				return (
					<div key={dependencyId} className='flex w-full items-center gap-2.5'>
						{dependencyPath ? (
							<Link to={dependencyPath} state={{fromAppStore: true}}>
								<AppIcon src={dependencyApp.icon} size={36} className='rounded-8' />
							</Link>
						) : (
							<AppIcon src={dependencyApp.icon} size={36} className='rounded-8' />
						)}
						<div className='flex min-w-0 flex-col'>
							{dependencyPath ? (
								<Link to={dependencyPath} state={{fromAppStore: true}} className='flex items-center gap-1.5'>
									<h3 className='truncate text-14 leading-tight font-semibold -tracking-3'>{dependencyApp.name}</h3>
									{installed && <TbCircleCheckFilled className='h-4 w-4 shrink-0 text-white/40' />}
								</Link>
							) : (
								<div className='flex items-center gap-1.5'>
									<h3 className='truncate text-14 leading-tight font-semibold -tracking-3'>{dependencyApp.name}</h3>
									{installed && <TbCircleCheckFilled className='h-4 w-4 shrink-0 text-white/40' />}
								</div>
							)}
							{numberOfAlternatives > 0 &&
								(showDependencies ? (
									<button
										className='self-start text-12 text-brand-lightest hover:text-brand-lighter'
										onClick={() => showDependencies(dependencyId)}
									>
										{alternativesLabel}
									</button>
								) : (
									<span className='self-start text-12 text-white/40'>{alternativesLabel}</span>
								))}
						</div>
					</div>
				)
			})}
		</section>
	)
}
