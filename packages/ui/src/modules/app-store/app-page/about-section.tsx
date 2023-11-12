import {cn} from '@/shadcn-lib/utils'
import {RegistryApp} from '@/trpc/trpc'

import {cardClass, cardTitleClass, ReadMoreSection} from './shared'

export const AboutSection = ({app}: {app: RegistryApp}) => (
	<div className={cn(cardClass, 'gap-2.5')}>
		<h2 className={cardTitleClass}>About</h2>
		<ReadMoreSection lines={6}>{app.description}</ReadMoreSection>
	</div>
)
