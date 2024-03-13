import {format} from 'date-fns'
import {useEffect, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {indexBy} from 'remeda'

import {Arc} from '@/components/ui/arc'
import {H1, H2, H3} from '@/layouts/stories'
import {usePager} from '@/modules/desktop/app-grid/app-pagination-utils'
import {ExampleWidget, LoadingWidget, Widget} from '@/modules/widgets'
import {FourUpWidget} from '@/modules/widgets/four-up-widget'
import {ListEmojiWidget} from '@/modules/widgets/list-emoji-widget'
import {ListWidget} from '@/modules/widgets/list-widget'
import {ProgressWidget} from '@/modules/widgets/progress-widget'
import {liveUsageWidgets, RegistryWidget, WidgetType, widgetTypes} from '@/modules/widgets/shared/constants'
import {TablerIcon} from '@/modules/widgets/shared/tabler-icon'
import {WidgetWrapper} from '@/modules/widgets/shared/widget-wrapper'
import {StatWithButtonsWidget} from '@/modules/widgets/stat-with-buttons-widget'
import {ThreeUpWidget} from '@/modules/widgets/three-up-widget'
import {TwoUpWidget} from '@/modules/widgets/two-up-widget'
import {AppsProvider} from '@/providers/apps'
import {Input, Labeled} from '@/shadcn-components/ui/input'
import {tw} from '@/utils/tw'

export const demoWidgetRegistryConfigs = [
	{
		appId: 'bitcoin',
		widgets: [
			{
				id: 'bitcoin:sync',
				type: 'stat-with-progress',
			},
			{
				id: 'bitcoin:stats',
				type: 'four-up',
			},
		],
	},
	{
		appId: 'lightning',
		widgets: [
			{
				id: 'lightning:balance-and-transact',
				type: 'stat-with-buttons',
			},
			{
				id: 'lightning:connections',
				type: 'four-up',
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
							type: 'stat-with-progress',
							// endpoint: '/widgets/example/four-up.json',
						}}
					/>
				</div>
				<H2>Widget Types</H2>
				<H3>stat-with-buttons</H3>
				<div className={sectionClass}>
					<StatWithButtonsWidget />
					<StatWithButtonsWidget
						onClick={handleClick}
						title='Bitcoin Wallet'
						value='1,845,893'
						valueSub='sats'
						// @ts-expect-error expecting title
						buttons={[{link: '/send'}]}
					/>
					<StatWithButtonsWidget
						onClick={handleClick}
						title='Bitcoin Wallet'
						value='1,845,893'
						valueSub='sats'
						buttons={[{text: 'Send', link: '/send'}]}
					/>
					<StatWithButtonsWidget
						onClick={handleClick}
						title='Bitcoin Wallet'
						value='1,845,893'
						valueSub='sats'
						buttons={[{icon: 'send', text: 'Send', link: '/send'}]}
					/>
					<StatWithButtonsWidget
						onClick={handleClick}
						title='Bitcoin Wallet'
						value='1,845,893'
						valueSub='sats'
						buttons={[
							{icon: 'send', text: 'Send', link: '/send'},
							{icon: 'inbox', text: 'Receive', link: '/receive'},
						]}
					/>
					<StatWithButtonsWidget
						onClick={handleClick}
						title='Bitcoin Wallet'
						value='1,845,893'
						valueSub='sats'
						buttons={[
							{icon: 'send', text: 'Send', link: '/send'},
							{icon: 'inbox', text: 'Receive', link: '/receive'},
							{icon: 'inbox', text: 'Receive', link: '/receive'},
						]}
					/>
					<StatWithButtonsWidget
						onClick={handleClick}
						title='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.'
						value='Lorem'
						valueSub='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod'
						buttons={[
							{
								icon: 'send',
								text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod',
								link: '/send',
							},
						]}
					/>
					<StatWithButtonsWidget
						onClick={handleClick}
						title='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.'
						value='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod'
						valueSub='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod'
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
				<H3>stat-with-progress</H3>
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
				<H3>two-up-stat-with-progress</H3>
				<div className={sectionClass}>
					<TwoUpWidget />
					<TwoUpWidget
						// @ts-expect-error expecting 2 items
						items={[
							{
								title: 'CPU',
								value: '4.2',
								valueSub: '%',
								progress: 0.25,
							},
						]}
					/>
					<TwoUpWidget
						items={[
							{
								// title: 'CPU',
								value: '4.2',
								valueSub: '%',
								progress: 0.75,
							},
							{
								// title: 'CPU',
								value: '4.2',
								valueSub: '%',
								progress: 0.75,
							},
						]}
					/>
					<TwoUpWidget
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
					<TwoUpWidget
						items={[
							{
								title: 'CPU',
								value: '4.2',
								valueSub: '%',
								progress: 0.75,
							},
							{
								title: 'CPU',
								value: '4.2',
								valueSub: '%',
								progress: 0.75,
							},
						]}
					/>
					<TwoUpWidget
						items={[
							{
								title: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.',
								value: 'Lorem ipsum',
								valueSub: '%',
								progress: 0.75,
							},
							{
								title: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.',
								value: 'Lorem ipsum',
								valueSub: '%',
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
				<H3>three-up</H3>
				<div className={sectionClass}>
					<ThreeUpWidget />
					<ThreeUpWidget
						// @ts-expect-error expecting 3 items
						items={[{icon: 'cpu', title: 'CPU', value: '4.2 %'}]}
					/>
					<ThreeUpWidget
						// @ts-expect-error expecting 3 items
						items={[
							{icon: 'cpu', title: 'CPU', value: '4.2 %'},
							{icon: 'cpu', title: 'Memory', value: '16 GB'},
						]}
					/>
					<ThreeUpWidget
						items={[
							{icon: '', title: 'Storage', value: '256 GB'},
							{icon: '', title: 'Memory', value: '16 GB'},
							{icon: '', title: 'CPU', value: '4.2 %'},
							// {icon: 'hard-drive', title: 'Storage', value: '256 GB'},
						]}
					/>
					<ThreeUpWidget
						items={[
							{icon: 'cpu', title: 'Storage', value: '256 GB'},
							{icon: 'cpu', title: 'Memory', value: '16 GB'},
							{icon: 'cpu', title: 'CPU', value: '4.2 %'},
						]}
					/>
					<ThreeUpWidget
						items={[
							{icon: 'cpu', title: 'Storage', value: '256 GB'},
							{icon: 'cpu', title: 'Memory', value: '16 GB'},
							{icon: 'cpu', title: 'CPU', value: '4.2 %'},
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
				<H3>four-up</H3>
				<div className={sectionClass}>
					<FourUpWidget />
					<FourUpWidget
						items={[
							{title: 'Storage', value: '256', valueSub: 'GB'},
							{title: 'Memory', value: '16', valueSub: 'GB'},
							{title: 'CPU', value: '4.2', valueSub: '%'},
							{title: 'CPU', value: '4.2', valueSub: '%'},
						]}
					/>
					<FourUpWidget onClick={handleClick} items={[{title: 'CPU', value: '4.2', valueSub: '%'}]} />
				</div>
				<H3>list</H3>
				<div className={sectionClass}>
					<ListWidget />
					<ListWidget
						onClick={handleClick}
						items={[
							{
								text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.',
								textSub: formatTimestampNumber(1620000000000),
							},
							{
								text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.',
								textSub: formatTimestampNumber(1620000000000),
							},
						]}
					/>
					<ListWidget
						onClick={handleClick}
						items={[
							{
								text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed euismod.',
								textSub: formatTimestampNumber(1620000000000),
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
					<ListEmojiWidget count={1} items={[{emoji: '😍', text: 'Message heartted'}]} />
					<ListEmojiWidget
						count={123}
						items={[
							{text: 'Message heartted'},
							{text: 'Booo!!'},
							{text: 'Rain expected'},
							{text: 'Search started'},
							{text: 'lskdfjsdlkfjsdlfkj'},
						]}
					/>
					<ListEmojiWidget
						count={123}
						items={[
							{emoji: '😍', text: 'Message heartted'},
							{emoji: '👻', text: 'Booo!!'},
							{emoji: '☂️', text: 'Rain expected'},
							{emoji: '🔍', text: 'Search started'},
							{emoji: '❤️', text: 'lskdfjsdlkfjsdlfkj'},
						]}
					/>
					<ListEmojiWidget
						count={123123123}
						items={[
							{emoji: '😍', text: 'Message heartted'},
							{emoji: '👻', text: 'Booo!!'},
							{emoji: '☂️', text: 'Rain expected'},
							{emoji: '🔍', text: 'Search started'},
							{emoji: '❤️', text: 'lskdfjsdlkfjsdlfkj'},
						]}
					/>
					<ListEmojiWidget
						count={123123123123123}
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
				<WidgetWrapper label={'two-up-stat-with-progress'}>
					<Widget
						appId='settings'
						config={{
							id: 'settings:system-stats',
							type: 'two-up-stat-with-progress',
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
	// const [widgetType, setWidgetType] = useState<WidgetType>('stat-with-progress')
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
