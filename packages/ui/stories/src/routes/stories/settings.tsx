import {H2, H3} from '@stories/components'
import {useState} from 'react'
import {range, shuffle} from 'remeda'

import {Card} from '@/components/ui/card'
import {SegmentedControl} from '@/components/ui/segmented-control'
import {DesktopPreviewFrame} from '@/modules/desktop/desktop-preview'
import {DesktopPreview} from '@/modules/desktop/desktop-preview-basic'
import {wallpaperIds} from '@/providers/wallpaper'
import {CpuTemperatureCardContent} from '@/routes/settings/_components/cpu-temperature-card-content'
import {DeviceInfoContent, HostEnvironmentIcon} from '@/routes/settings/_components/device-info-content'
import {ProgressStatCardContent} from '@/routes/settings/_components/progress-card-content'
import {Button} from '@/shadcn-components/ui/button'
import {Separator} from '@/shadcn-components/ui/separator'

export default function SettingsStory() {
	const [cpuWarning, setCpuWarning] = useState<string>('normal')

	const wId = shuffle(wallpaperIds)[0]

	return (
		<div className='flex flex-col flex-wrap items-start gap-8 bg-white/10 p-8'>
			<DesktopPreviewFrame>
				<DesktopPreview
					wallpaperId={wId}
					userName='John Doe'
					widgets={[]}
					apps={range(0, 50).map(() => ({
						icon: 'https://source.unsplash.com/random/100x100',
						name: 'sdlfksjdflksdjflksjdkf',
					}))}
				/>
			</DesktopPreviewFrame>
			<DesktopPreviewFrame>
				<DesktopPreview
					wallpaperId={wId}
					userName='John Doe'
					widgets={[
						{
							type: 'four-stats',
							app: {
								name: 'sdlfkjsdflk',
							},
							id: 'sdfsdf',
						},
					]}
					apps={range(0, 50).map(() => ({
						icon: 'https://source.unsplash.com/random/100x100',
						name: 'sdlfksjdflksdjflksjdkf',
					}))}
				/>
			</DesktopPreviewFrame>
			<DesktopPreviewFrame>
				<DesktopPreview
					wallpaperId={wId}
					userName='John Doe'
					widgets={range(0, 3).map((i) => ({app: {name: 'sdlfkjsdflk'}, id: i.toString(), type: 'four-stats'}))}
					apps={range(0, 50).map(() => ({
						icon: 'https://source.unsplash.com/random/100x100',
						name: 'sdlfksjdflksdjflksjdkf',
					}))}
				/>
			</DesktopPreviewFrame>
			<H3>Device Icons</H3>
			<div className='flex gap-4'>
				<HostEnvironmentIcon />
				<HostEnvironmentIcon environment='umbrel-home' />
				<HostEnvironmentIcon environment='raspberry-pi' />
				<HostEnvironmentIcon environment='unknown' />
				<HostEnvironmentIcon environment='docker-container' />
			</div>
			<div className='flex flex-wrap gap-2 bg-red-500/10'>
				<DeviceInfoContent />
				<DeviceInfoContent umbrelHostEnvironment='umbrel-home' modelNumber='U130121' serialNumber='U230300078' />
				<DeviceInfoContent umbrelHostEnvironment='raspberry-pi' />
				<DeviceInfoContent umbrelHostEnvironment='unknown' />
				<DeviceInfoContent umbrelHostEnvironment='docker-container' />
			</div>
			<H2>Progress Card</H2>
			<Card>
				<ProgressStatCardContent
					title='Sync Status'
					value='69.69'
					valueSub='%'
					secondaryValue='69.69 GB'
					progress={0.6969}
				/>
			</Card>
			<Card>
				<ProgressStatCardContent
					title='Ljgrem Ipsum Dolor Sit Amet'
					value='Ljgrem Ipsum Dolor Sit Amet'
					valueSub='Ljgrem Ipsum Dolor Sit Amet'
					secondaryValue='Ljgrem Ipsum Dolor Sit Amet'
					progress={0.6969}
				/>
			</Card>
			<div className='w-[300px] resize-x overflow-auto bg-red-500/10 p-4'>
				<Card>
					<ProgressStatCardContent
						title='Ljgrem Ipsum Dolor Sit Amet'
						value='Ljgrem Ipsum Dolor Sit Amet'
						valueSub='Ljgrem Ipsum Dolor Sit Amet'
						secondaryValue='Ljgrem Ipsum Dolor Sit Amet'
						progress={0.6969}
					/>
				</Card>
			</div>
			{/* ------- */}
			<H2>Temperature Card</H2>
			<SegmentedControl
				size='lg'
				// variant={variant}
				tabs={['normal', 'warm', 'hot'].map((warning) => ({id: warning, label: warning.toUpperCase()}))}
				value={cpuWarning}
				onValueChange={setCpuWarning}
			/>
			<Button
				onClick={() => {
					localStorage.removeItem('UMBREL_temp-unit')
					window.location.reload()
				}}
			>
				Clear local storage temp
			</Button>
			<H3>Extreme</H3>
			<div className='w-[300px] resize-x overflow-auto bg-red-500/10 p-4'>
				<Card>
					<CpuTemperatureCardContent warning={cpuWarning} temperatureInCelcius={-999999} />
				</Card>
			</div>
			<div className='w-[300px] resize-x overflow-auto bg-red-500/10 p-4'>
				<Card>
					<CpuTemperatureCardContent warning={cpuWarning} temperatureInCelcius={999999} />
				</Card>
			</div>
			<H3>undefined</H3>
			<Card>
				<CpuTemperatureCardContent warning={cpuWarning} />
			</Card>
			<H3>NaN</H3>
			<Card>
				<CpuTemperatureCardContent warning={cpuWarning} temperatureInCelcius={NaN} defaultUnit='c' />
			</Card>
			<H3>Infinity</H3>
			<Card>
				<CpuTemperatureCardContent warning={cpuWarning} temperatureInCelcius={Infinity} defaultUnit='c' />
			</Card>
			<H3>69</H3>
			<Card>
				<CpuTemperatureCardContent warning={cpuWarning} temperatureInCelcius={69} defaultUnit='c' />
			</Card>
			<Card>
				<CpuTemperatureCardContent warning={cpuWarning} temperatureInCelcius={20.5} defaultUnit='f' />
			</Card>
			<Separator />
		</div>
	)
}
