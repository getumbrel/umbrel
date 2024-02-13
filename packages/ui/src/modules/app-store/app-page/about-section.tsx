import {cn} from '@/shadcn-lib/utils'
import {RegistryApp} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

import {cardClass, cardTitleClass, ReadMoreMarkdownSection} from './shared'

export const AboutSection = ({app}: {app: RegistryApp}) => (
	<div className={cn(cardClass, 'gap-2.5')}>
		<h2 className={cardTitleClass}>{t('app-page.section.about')}</h2>
		<ReadMoreMarkdownSection collapseClassName={tw`line-clamp-6`}>{app.description}</ReadMoreMarkdownSection>
	</div>
)
