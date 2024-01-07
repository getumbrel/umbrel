import {useLayoutEffect, useState} from 'react'

import {UserAppsProvider} from '@/hooks/use-user-apps'
import {settingsWidgets} from '@/hooks/use-widgets'
import {H2, H3} from '@/layouts/stories'
import {Widget} from '@/modules/widgets'
import {ActionsWidget} from '@/modules/widgets/actions-widget'
import {FourUpWidget} from '@/modules/widgets/four-up-widget'
import {NotificationsWidget} from '@/modules/widgets/notifications-widget'
import {ProgressWidget} from '@/modules/widgets/progress-widget'
import {BackdropBlurVariantContext} from '@/modules/widgets/shared/backdrop-blur-context'
import {TablerIcon} from '@/modules/widgets/shared/tabler-icon'
import {WidgetWrapper} from '@/modules/widgets/shared/widget-wrapper'
import {StatWithButtonsWidget} from '@/modules/widgets/stat-with-buttons-widget'
import {ThreeUpWidget} from '@/modules/widgets/three-up-widget'
import {Input} from '@/shadcn-components/ui/input'
import {tw} from '@/utils/tw'

import {demoWidgetConfigs} from '../../../../umbreld/source/modules/apps/data'

export default function WidgetsStory() {
	// TODO: extract the sizes so we can render widgets outside the app grid
	useLayoutEffect(() => {
		const el = document.documentElement

		const widgetH = [110, 150][1]
		const widgetLabeledH = widgetH + 26 // widget rect + label

		const appW = [70, 120][1]
		// const appH = [90, 120][1]
		const appXGap = [20, 30][1]
		const widgetW = appW + appXGap + appW

		el.style.setProperty('--widget-w', `${widgetW}px`)
		el.style.setProperty('--widget-h', `${widgetH}px`)
		el.style.setProperty('--widget-labeled-h', `${widgetLabeledH}px`)
	}, [])

	// type ThreeUpItem = {icon: string; title?: string; value?: string}
	// function ThreeUpWidget({link, items}: {link?: string; items?: [ThreeUpItem, ThreeUpItem, ThreeUpItem]}) {
	// 	return null
	// }

	return (
		<UserAppsProvider>
			<div className='bg-white/30'>
				<H2>Error</H2>
				<div className={sectionClass}>
					<Widget appId='example' config={{type: 'stat-with-progress', endpoint: '/widgets/example/four-up.json'}} />
				</div>
				<H2>Blank</H2>
				<div className={sectionClass}>
					<ProgressWidget />
					<StatWithButtonsWidget />
					<ThreeUpWidget />
					<FourUpWidget />
					<ActionsWidget />
					<NotificationsWidget />
				</div>
				<H2>stat-with-buttons</H2>
				<div className={sectionClass}>
					<StatWithButtonsWidget />
					<StatWithButtonsWidget
						appUrl='/settings'
						title='Bitcoin Wallet'
						value='1,845,893'
						valueSub='sats'
						buttons={[{icon: 'send', title: 'Send', link: '/send'}]}
					/>
					<StatWithButtonsWidget
						appUrl='/settings'
						title='Bitcoin Wallet'
						value='1,845,893'
						valueSub='sats'
						buttons={[
							{icon: 'send', title: 'Send', link: '/send'},
							{icon: 'inbox', title: 'Receive', link: '/receive'},
						]}
					/>
					<StatWithButtonsWidget
						appUrl='/settings'
						title='Bitcoin Wallet'
						value='1,845,893'
						valueSub='sats'
						buttons={[
							{icon: 'send', title: 'Send', link: '/send'},
							{icon: 'inbox', title: 'Receive', link: '/receive'},
							{icon: 'inbox', title: 'Receive', link: '/receive'},
						]}
					/>
					<StatWithButtonsWidget
						appUrl='/settings'
						title='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.'
						value='Lorem'
						valueSub='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod'
						buttons={[
							{
								icon: 'send',
								title: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod',
								link: '/send',
							},
						]}
					/>
					<StatWithButtonsWidget
						appUrl='/settings'
						title='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.'
						value='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod'
						valueSub='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod'
						buttons={[
							{
								icon: 'send',
								title: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod',
								link: '/send',
							},
							{
								icon: 'inbox',
								title: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod',
								link: '/receive',
							},
							{
								icon: 'inbox',
								title: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod',
								link: '/receive',
							},
						]}
					/>
					<StatWithButtonsWidget
						appUrl='/settings'
						title='Bitcoin Wallet'
						value='1,845,893'
						valueSub='sats'
						buttons={[
							{icon: 'send', title: 'Send', link: '/send'},
							{icon: 'inbox', title: 'Receive', link: '/receive'},
							{icon: 'inbox', title: 'Receive', link: '/receive'},
							{icon: 'inbox', title: 'Receive', link: '/receive'},
						]}
					/>
				</div>
				<H2>stat-with-progress</H2>
				<div className={sectionClass}>
					<ProgressWidget />
					<ProgressWidget
						title='Storage'
						value='256 GB'
						valueSub='/ 2 TB'
						progressLabel='1.75 TB left'
						progress={0.25}
					/>
				</div>
				<H2>three-up</H2>
				<div className={sectionClass}>
					<ThreeUpWidget />
					<ThreeUpWidget
						// @ts-expect-error expecting 3 items
						items={[{icon: 'cpu', title: 'CPU', value: '4.2 GHz'}]}
					/>
					<ThreeUpWidget
						// @ts-expect-error expecting 3 items
						items={[
							{icon: 'cpu', title: 'CPU', value: '4.2 GHz'},
							{icon: 'cpu', title: 'Memory', value: '16 GB'},
						]}
					/>
					<ThreeUpWidget
						items={[
							{icon: '', title: 'CPU', value: '4.2 GHz'},
							{icon: '', title: 'Memory', value: '16 GB'},
							{icon: '', title: 'Storage', value: '256 GB'},
							// {icon: 'hard-drive', title: 'Storage', value: '256 GB'},
						]}
					/>
					<ThreeUpWidget
						items={[
							{icon: 'cpu', title: 'CPU', value: '4.2 GHz'},
							{icon: 'cpu', title: 'Memory', value: '16 GB'},
							{icon: 'cpu', title: 'Storage', value: '256 GB'},
						]}
					/>
					<ThreeUpWidget
						items={[
							{icon: 'cpu', title: 'CPU', value: '4.2 GHz'},
							{icon: 'cpu', title: 'Memory', value: '16 GB'},
							{icon: 'cpu', title: 'Storage', value: '256 GB'},
							// @ts-expect-error expecting 3 items
							{icon: 'cpu', title: 'Storage', value: '256 GB'},
						]}
					/>
					<ThreeUpWidget
						items={[
							{icon: 'cpu', title: 'Lorem ipsum dolor', value: 'Lorem ipsum dolor'},
							{icon: 'cpu', title: 'Lorem ipsum dolor', value: 'Lorem ipsum dolor'},
							{icon: 'cpu', title: 'Lorem ipsum dolor', value: 'Lorem ipsum dolor'},
						]}
					/>
				</div>
				<H2>four-up</H2>
				<div className={sectionClass}>
					<FourUpWidget />
					<FourUpWidget
						items={[
							{title: 'CPU', value: '4.2', valueSub: 'GHz'},
							{title: 'Memory', value: '16', valueSub: 'GB'},
							{title: 'Storage', value: '256', valueSub: 'GB'},
							{title: 'Storage', value: '256', valueSub: 'GB'},
						]}
					/>
					<FourUpWidget link='/settings' items={[{title: 'CPU', value: '4.2', valueSub: 'GHz'}]} />
				</div>
				<H2>actions</H2>
				<div className={sectionClass}>
					<ActionsWidget />
					<ActionsWidget count={1} actions={[{emoji: '😍', title: 'Message heartted'}]} />
					<ActionsWidget
						count={123}
						actions={[
							{title: 'Message heartted'},
							{title: 'Booo!!'},
							{title: 'Rain expected'},
							{title: 'Search started'},
							{title: 'lskdfjsdlkfjsdlfkj'},
						]}
					/>
					<ActionsWidget
						count={123}
						actions={[
							{emoji: '😍', title: 'Message heartted'},
							{emoji: '👻', title: 'Booo!!'},
							{emoji: '☂️', title: 'Rain expected'},
							{emoji: '🔍', title: 'Search started'},
							{emoji: '❤️', title: 'lskdfjsdlkfjsdlfkj'},
						]}
					/>
					<ActionsWidget
						count={123123123}
						actions={[
							{emoji: '😍', title: 'Message heartted'},
							{emoji: '👻', title: 'Booo!!'},
							{emoji: '☂️', title: 'Rain expected'},
							{emoji: '🔍', title: 'Search started'},
							{emoji: '❤️', title: 'lskdfjsdlkfjsdlfkj'},
						]}
					/>
					<ActionsWidget
						count={123123123123123}
						actions={[
							{emoji: '😍😍😍😍', title: 'Message heartted'},
							{emoji: '👻', title: 'Booo!!'},
							{emoji: '☂️', title: 'Rain expected'},
							{emoji: '🔍', title: 'Search started'},
							{emoji: '❤️', title: 'lskdfjsdlkfjsdlfkj'},
						]}
					/>
				</div>
				<H2>notifications</H2>
				<div className={sectionClass}>
					<NotificationsWidget />
					<NotificationsWidget
						link=''
						notifications={[
							{
								timestamp: 1620000000000,
								description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.',
							},
							{
								timestamp: 1620000000000,
								description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.',
							},
						]}
					/>
					<NotificationsWidget
						link=''
						notifications={[
							{
								timestamp: 1620000000000,
								description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.',
							},
						]}
					/>
				</div>
				{/* ------------------------------------ */}
				<H2>Connected</H2>
				<H3>settings</H3>
				<div className='flex flex-wrap gap-2'>
					{settingsWidgets.map((widget) => (
						<WidgetWrapper key={widget.endpoint} label={widget.type}>
							<Widget appId='example' config={widget} />
						</WidgetWrapper>
					))}
				</div>
				{demoWidgetConfigs.map((app) => (
					<>
						<H3>{app.appId}</H3>
						<div className='flex flex-wrap gap-2'>
							{app.widgets.map((widget, i) => (
								<WidgetWrapper key={i} label={widget.type}>
									<Widget appId={app.appId} config={widget} />
								</WidgetWrapper>
							))}
						</div>
					</>
				))}
				<H2>With widget wrapper</H2>
				<WidgetWrapper label='fooo'>
					<ActionsWidget />
				</WidgetWrapper>
			</div>
		</UserAppsProvider>
	)
}

const sectionClass = tw`flex flex-wrap gap-2 p-5`
