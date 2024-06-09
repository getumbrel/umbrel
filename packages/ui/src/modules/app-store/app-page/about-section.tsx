import {cn} from '@/shadcn-lib/utils'
import {RegistryApp} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {cardClass, cardTitleClass, ReadMoreMarkdownSection} from './shared'

export const AboutSection = ({app}: {app: RegistryApp}) => (
	<div className={cn(cardClass, 'gap-2.5')}>
		<h2 className={cardTitleClass}>{t('app-page.section.about')}</h2>
		{/* Adding key to reset state when updating content */}
		<ReadMoreMarkdownSection key={app.description}>{app.description}</ReadMoreMarkdownSection>
	</div>
)
