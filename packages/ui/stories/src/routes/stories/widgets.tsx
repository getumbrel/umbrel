import {H1, H2, H3} from '@stories/components'
import {format} from 'date-fns'
import {useEffect, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {indexBy} from 'remeda'

import {Arc} from '@/components/ui/arc'
import {usePager} from '@/modules/desktop/app-grid/app-pagination-utils'
import {ExampleWidget, LoadingWidget, Widget} from '@/modules/widgets'
import {FourStatsWidget} from '@/modules/widgets/four-stats-widget'
import {ListEmojiWidget} from '@/modules/widgets/list-emoji-widget'
import {ListWidget} from '@/modules/widgets/list-widget'
import {liveUsageWidgets, RegistryWidget, WidgetType, widgetTypes} from '@/modules/widgets/shared/constants'
import {TablerIcon} from '@/modules/widgets/shared/tabler-icon'
import {WidgetWrapper} from '@/modules/widgets/shared/widget-wrapper'
import {TextWithButtonsWidget} from '@/modules/widgets/text-with-buttons-widget'
import {TextWithProgressWidget} from '@/modules/widgets/text-with-progress-widget'
import {ThreeStatsWidget} from '@/modules/widgets/three-stats-widget'
import {TwoStatsWidget} from '@/modules/widgets/two-stats-with-guage-widget'
import {AppsProvider} from '@/providers/apps'
import {Input, Labeled} from '@/shadcn-components/ui/input'
import {linkClass} from '@/utils/element-classes'
import {tw} from '@/utils/tw'

export const demoWidgetRegistryConfigs = [
	{
		appId: 'bitcoin',
		widgets: [
			{
				id: 'bitcoin:sync',
				type: 'text-with-progress',
			},
			{
				id: 'bitcoin:stats',
				type: 'four-stats',
			},
		],
	},
	{
		appId: 'lightning',
		widgets: [
			{
				id: 'lightning:balance-and-transact',
				type: 'text-with-buttons',
			},
			{
				id: 'lightning:connections',
				type: 'four-stats',
			},
		],
	},
	{
		appId: 'nostr-relay',
		widgets: [
			{
				id: 'nostr-relay:stats',
				type: 'list-emoji',
			},
			{
				id: 'nostr-relay:notifications',
				type: 'list',
			},
		],
	},
] satisfies {
	appId: string
	widgets: RegistryWidget<WidgetType>[]
}[]

export const demoWidgetConfigsKeyed = indexBy(demoWidgetRegistryConfigs, (widget) => widget.appId)

const formatTimestampNumber = (ts: number) => format(ts, 'h:mm aaa · MMM d')

export default function WidgetsStory() {
	const {pageInnerRef} = usePager({apps: [], widgets: []})

	const handleClick = () => {
		alert('clicked')
	}

	return (
		<AppsProvider>
			<H1>Widgets</H1>
			<TablerIconExample />
			<div className='bg-white/30' ref={pageInnerRef}>
				<H2>Any</H2>
				<EditableWidget />
				<H2>Widget type</H2>
				<H2>Error</H2>
				<div className={sectionClass}>
					<Widget
						appId='example'
						config={{
							id: 'example:error',
							type: 'text-with-progress',
							// endpoint: '/widgets/example/four-stats.json',
						}}
					/>
				</div>
				<H2>Widget Types</H2>
				<H3>text-with-buttons</H3>
				<div className={sectionClass}>
					<TextWithButtonsWidget />
					<TextWithButtonsWidget
						onClick={handleClick}
						title='Bitcoin Wallet'
						text='1,845,893'
						subtext='sats'
						buttons={[{link: '/send'}]}
					/>
					<TextWithButtonsWidget
						onClick={handleClick}
						title='Bitcoin Wallet'
						text='1,845,893'
						subtext='sats'
						buttons={[{text: 'Send', link: '/send'}]}
					/>
					<TextWithButtonsWidget
						onClick={handleClick}
						title='Bitcoin Wallet'
						text='1,845,893'
						subtext='sats'
						buttons={[{icon: 'send', text: 'Send', link: '/send'}]}
					/>
					<TextWithButtonsWidget
						onClick={handleClick}
						title='Bitcoin Wallet'
						text='1,845,893'
						subtext='sats'
						buttons={[
							{icon: 'send', text: 'Send', link: '/send'},
							{icon: 'inbox', text: 'Receive', link: '/receive'},
						]}
					/>
					<TextWithButtonsWidget
						onClick={handleClick}
						title='Bitcoin Wallet'
						text='1,845,893'
						subtext='sats'
						buttons={[
							{icon: 'send', text: 'Send', link: '/send'},
							{icon: 'inbox', text: 'Receive', link: '/receive'},
							{icon: 'inbox', text: 'Receive', link: '/receive'},
						]}
					/>
					<TextWithButtonsWidget
						onClick={handleClick}
						title='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.'
						text='Lorem'
						subtext='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod'
						buttons={[
							{
								icon: 'send',
								text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod',
								link: '/send',
							},
						]}
					/>
					<TextWithButtonsWidget
						onClick={handleClick}
						title='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.'
						text='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod'
						subtext='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod'
						buttons={[
							{
								// icon: 'send',
								text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod',
								link: '/send',
							},
							{
								// icon: 'inbox',
								text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod',
								link: '/receive',
							},
							{
								icon: 'inbox',
								text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod',
								link: '/receive',
							},
						]}
					/>
				</div>
				<H3>text-with-progress</H3>
				<div className={sectionClass}>
					<TextWithProgressWidget />
					<TextWithProgressWidget
						title='Storage'
						text='256 GB'
						subtext='/ 2 TB'
						progressLabel='1.75 TB left'
						progress={0.25}
					/>
				</div>
				<H3>two-stats-with-guage</H3>
				<div className={sectionClass}>
					<TwoStatsWidget />
					<TwoStatsWidget
						// @ts-expect-error expecting 2 items
						items={[
							{
								title: 'CPU',
								text: '4.2',
								subtext: '%',
								progress: 0.25,
							},
						]}
					/>
					<TwoStatsWidget
						items={[
							{
								// title: 'CPU',
								text: '4.2',
								subtext: '%',
								progress: 0.75,
							},
							{
								// title: 'CPU',
								text: '4.2',
								subtext: '%',
								progress: 0.75,
							},
						]}
					/>
					<TwoStatsWidget
						items={[
							{
								title: 'CPU',
								// value: '4.2',
								// valueSub: '%',
								progress: 0.75,
							},
							{
								title: 'CPU',
								// value: '4.2',
								// valueSub: '%',
								progress: 0.75,
							},
						]}
					/>
					<TwoStatsWidget
						items={[
							{
								title: 'CPU',
								text: '4.2',
								subtext: '%',
								progress: 0.75,
							},
							{
								title: 'CPU',
								text: '4.2',
								subtext: '%',
								progress: 0.75,
							},
						]}
					/>
					<TwoStatsWidget
						items={[
							{
								title: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.',
								text: 'Lorem ipsum',
								subtext: '%',
								progress: 0.75,
							},
							{
								title: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.',
								text: 'Lorem ipsum',
								subtext: '%',
								progress: 0.75,
							},
						]}
					/>
					<Arc strokeWidth={5} size={65} progress={0.0} />
					<Arc strokeWidth={5} size={65} progress={0.25} />
					<Arc strokeWidth={5} size={65} progress={0.5} />
					<Arc strokeWidth={5} size={65} progress={0.75} />
					<Arc strokeWidth={5} size={65} progress={1} />
				</div>
				<H3>three-stats</H3>
				<div className={sectionClass}>
					<ThreeStatsWidget />
					<ThreeStatsWidget
						// @ts-expect-error expecting 3 items
						items={[{icon: 'cpu', subtext: 'CPU', text: '4.2 %'}]}
					/>
					<ThreeStatsWidget
						// @ts-expect-error expecting 3 items
						items={[
							{icon: 'cpu', subtext: 'CPU', text: '4.2 %'},
							{icon: 'cpu', subtext: 'Memory', text: '16 GB'},
						]}
					/>
					<ThreeStatsWidget
						items={[
							{icon: '', subtext: 'Storage', text: '256 GB'},
							{icon: '', subtext: 'Memory', text: '16 GB'},
							{icon: '', subtext: 'CPU', text: '4.2 %'},
							// {icon: 'hard-drive', title: 'Storage', value: '256 GB'},
						]}
					/>
					<ThreeStatsWidget
						items={[
							{icon: 'cpu', subtext: 'Storage', text: '256 GB'},
							{icon: 'cpu', subtext: 'Memory', text: '16 GB'},
							{icon: 'cpu', subtext: 'CPU', text: '4.2 %'},
						]}
					/>
					<ThreeStatsWidget
						items={[
							{icon: 'cpu', subtext: 'Storage', text: '256 GB'},
							{icon: 'cpu', subtext: 'Memory', text: '16 GB'},
							{icon: 'cpu', subtext: 'CPU', text: '4.2 %'},
							// @ts-expect-error expecting 3 items
							{icon: 'cpu', title: 'Storage', value: '256 GB'},
						]}
					/>
					<ThreeStatsWidget
						items={[
							{icon: 'cpu', subtext: 'Lorem ipsum dolor', text: 'Lorem ipsum dolor'},
							{icon: 'cpu', subtext: 'Lorem ipsum dolor', text: 'Lorem ipsum dolor'},
							{icon: 'cpu', subtext: 'Lorem ipsum dolor', text: 'Lorem ipsum dolor'},
						]}
					/>
				</div>
				<H3>four-stats</H3>
				<div className={sectionClass}>
					<FourStatsWidget />
					<FourStatsWidget
						items={[
							{title: 'Storage', text: '256', subtext: 'GB'},
							{title: 'Memory', text: '16', subtext: 'GB'},
							{title: 'CPU', text: '4.2', subtext: '%'},
							{title: 'CPU', text: '4.2', subtext: '%'},
						]}
					/>
					{/* @ts-expect-error expecting 4 items */}
					<FourStatsWidget onClick={handleClick} items={[{title: 'CPU', text: '4.2', subtext: '%'}]} />
				</div>
				<H3>list</H3>
				<div className={sectionClass}>
					<ListWidget />
					<ListWidget
						onClick={handleClick}
						items={[
							{
								text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.',
								subtext: formatTimestampNumber(1620000000000),
							},
							{
								text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.',
								subtext: formatTimestampNumber(1620000000000),
							},
						]}
					/>
					<ListWidget
						onClick={handleClick}
						items={[
							{
								text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.',
								subtext: formatTimestampNumber(1620000000000),
							},
						]}
					/>
					<div className='w-full'>
						<code>items: undefined</code>
						<ListWidget onClick={handleClick} />
					</div>
					<div className='w-full'>
						<code>items: []</code>
						<ListWidget onClick={handleClick} items={[]} />
					</div>
					<div className='w-full'>
						<code>items: [], noItemsText: 'Nothing downloading'</code>
						<ListWidget onClick={handleClick} items={[]} noItemsText='Nothing downloading' />
					</div>
				</div>
				<H3>list-emoji</H3>
				<div className={sectionClass}>
					<ListEmojiWidget />
					<ListEmojiWidget count={'1'} items={[{emoji: '😍', text: 'Message heartted'}]} />
					<ListEmojiWidget
						count={'123'}
						items={[
							{text: 'Message heartted'},
							{text: 'Booo!!'},
							{text: 'Rain expected'},
							{text: 'Search started'},
							{text: 'lskdfjsdlkfjsdlfkj'},
						]}
					/>
					<ListEmojiWidget
						count={'123'}
						items={[
							{emoji: '😍', text: 'Message heartted'},
							{emoji: '👻', text: 'Booo!!'},
							{emoji: '☂️', text: 'Rain expected'},
							{emoji: '🔍', text: 'Search started'},
							{emoji: '❤️', text: 'lskdfjsdlkfjsdlfkj'},
						]}
					/>
					<ListEmojiWidget
						count={'123123123'}
						items={[
							{emoji: '😍', text: 'Message heartted'},
							{emoji: '👻', text: 'Booo!!'},
							{emoji: '☂️', text: 'Rain expected'},
							{emoji: '🔍', text: 'Search started'},
							{emoji: '❤️', text: 'lskdfjsdlkfjsdlfkj'},
						]}
					/>
					<ListEmojiWidget
						count={'123123123123123'}
						items={[
							{emoji: '😍😍😍😍', text: 'Message heartted'},
							{emoji: '👻', text: 'Booo!!'},
							{emoji: '☂️', text: 'Rain expected'},
							{emoji: '🔍', text: 'Search started'},
							{emoji: '❤️', text: 'lskdfjsdlkfjsdlfkj'},
						]}
					/>
				</div>
				{/* ------------------------------------ */}
				<H2>With widget wrapper</H2>
				<WidgetWrapper label='fooo'>
					<ListEmojiWidget />
				</WidgetWrapper>
				{/* ------------------------------------ */}
				<H2>Connected</H2>
				<H3>settings</H3>
				<div className='flex flex-wrap gap-2'>
					{liveUsageWidgets.map((widget) => (
						<WidgetWrapper key={widget.id} label={widget.type}>
							<Widget appId='example' config={widget} />
						</WidgetWrapper>
					))}
				</div>
				{demoWidgetRegistryConfigs.map((app) => (
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
				<WidgetWrapper label={'two-stats-with-guage'}>
					<Widget
						appId='settings'
						config={{
							id: 'settings:system-stats',
							type: 'two-stats-with-guage',
						}}
					/>
				</WidgetWrapper>
			</div>
		</AppsProvider>
	)
}

function TablerIconExample() {
	const [custom, setCustom] = useState('trash')
	return (
		<div className='flex flex-row gap-2'>
			<div className='flex flex-col gap-2'>
				<Labeled label='Custom icon'>
					<Input value={custom} onValueChange={setCustom} />
				</Labeled>
				<TablerIcon iconName={custom} className='h-10 w-10 [&>svg]:h-10 [&>svg]:w-10' />
				<a href='https://tabler.io/icons' target='_blank' rel='noopener noreferrer' className={linkClass}>
					Tabler icons
				</a>
			</div>
			<div className='flex flex-col gap-2'>
				system-widget-memory
				<TablerIcon iconName='system-widget-memory' />
				system-widget-storage
				<TablerIcon iconName='system-widget-storage' />
				system-widget-temperature
				<TablerIcon iconName='system-widget-temperature' />
				system-widget-cpu
				<TablerIcon iconName='system-widget-cpu' />
			</div>
		</div>
	)
}

export function EditableWidget() {
	const [code, setCode] = useState(JSON.stringify(liveUsageWidgets[0], null, 2))
	// const [widgetType, setWidgetType] = useState<WidgetType>('text-with-progress')
	const [registryConfig, setRegistryConfig] = useState<RegistryWidget>(liveUsageWidgets[0])
	const [error, setError] = useState('')

	useEffect(() => {
		let json: any
		try {
			json = JSON.parse(code)
			setError('')
			setRegistryConfig(json)
		} catch (e) {
			console.error(e)
			setError('Invalid JSON: ' + (e as Error).message)
		}
	}, [code])

	return (
		<div className='grid grid-cols-2 gap-2'>
			<div>
				<label htmlFor='widget-type'>Widget type</label>
				<select
					id='widget-type'
					className='w-full bg-black'
					value={registryConfig?.type}
					onChange={(e) => {
						const newConfig = {...registryConfig, type: e.target.value as WidgetType}
						setCode(JSON.stringify(newConfig, null, 2))
					}}
				>
					{widgetTypes.map((type) => (
						<option key={type} value={type}>
							{type}
						</option>
					))}
				</select>
				<textarea
					className='h-[200px] w-full border border-white/10 bg-black p-2 font-mono'
					value={code}
					onChange={(e) => {
						setCode(e.target.value)
					}}
				/>
				{error && <div className='bg-black text-red-500'>{error}</div>}
			</div>
			<ErrorBoundary fallback={<LoadingWidget type={registryConfig?.type} />}>
				<ExampleWidget type={registryConfig?.type} example={registryConfig?.example} />
			</ErrorBoundary>
		</div>
	)
}

const sectionClass = tw`flex flex-wrap gap-2 p-5`
