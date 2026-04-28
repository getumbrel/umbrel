import {useTranslation} from 'react-i18next'

import {cn} from '@/lib/utils'
import {RegistryApp} from '@/trpc/trpc'

import {cardClass, cardTitleClass, ReadMoreMarkdownSection} from './shared'

export const ReleaseNotesSection = ({app}: {app: RegistryApp}) => {
	const {t} = useTranslation()
	return (
		<>
			{app.releaseNotes && (
				<div className={cn(cardClass, 'gap-2.5')}>
					<h2 className={cardTitleClass}>{t('app-page.section.release-notes.title')}</h2>
					<h3 className='text-16 font-semibold'>
						{t('app-page.section.release-notes.version', {version: app.version})}
					</h3>
					{/* Adding key to reset state when updating content */}
					<ReadMoreMarkdownSection key={app.releaseNotes}>{app.releaseNotes}</ReadMoreMarkdownSection>
				</div>
			)}
		</>
	)
}
