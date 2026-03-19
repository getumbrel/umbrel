import {useTranslation} from 'react-i18next'

import {cn} from '@/lib/utils'
import {RegistryApp} from '@/trpc/trpc'

import {cardClass, cardTitleClass, ReadMoreMarkdownSection} from './shared'

export const AboutSection = ({app}: {app: RegistryApp}) => {
	const {t} = useTranslation()
	return (
		<div className={cn(cardClass, 'gap-2.5')}>
			<h2 className={cardTitleClass}>{t('app-page.section.about')}</h2>
			{/* Adding key to reset state when updating content */}
			<ReadMoreMarkdownSection key={app.description}>{app.description}</ReadMoreMarkdownSection>
		</div>
	)
}
