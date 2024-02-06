import {cn} from '@/shadcn-lib/utils'
import {RegistryApp} from '@/trpc/trpc'
import {tw} from '@/utils/tw'

import {cardClass, cardTitleClass, ReadMoreMarkdownSection} from './shared'

export const ReleaseNotesSection = ({app}: {app: RegistryApp}) => (
	<>
		{app.releaseNotes && (
			<div className={cn(cardClass, 'gap-2.5')}>
				<h2 className={cardTitleClass}>What’s new</h2>
				<h3 className='text-16 font-semibold'>Version {app.version}</h3>
				<ReadMoreMarkdownSection collapseClassName={tw`line-clamp-10`}>{app.releaseNotes}</ReadMoreMarkdownSection>
			</div>
		)}
	</>
)
