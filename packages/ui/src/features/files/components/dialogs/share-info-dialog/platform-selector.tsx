import {ChevronDown} from 'lucide-react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import iOsIcon from '@/features/files/assets/sharing-info-platforms/ios.png'
import macOsIcon from '@/features/files/assets/sharing-info-platforms/macos.png'
import windowsIcon from '@/features/files/assets/sharing-info-platforms/windows.png'
import umbrelDeviceIconActive from '@/features/files/assets/umbrel-device-icon-active.png'

export type Platform = {
	id: 'macos' | 'ios' | 'windows' | 'umbrelos'
	name: string
	icon: string
}

export const platforms: Platform[] = [
	{id: 'macos', name: 'macOS', icon: macOsIcon},
	{id: 'windows', name: 'Windows', icon: windowsIcon},
	{id: 'ios', name: 'iOS', icon: iOsIcon},
	{id: 'umbrelos', name: 'Another Umbrel', icon: umbrelDeviceIconActive},
]

export function getDefaultPlatform(): Platform | undefined {
	const {userAgent, maxTouchPoints} = navigator
	const isMac = /Mac/i.test(userAgent)
	// iPadOS can use a Mac user agent when requesting desktop websites.
	const isIOS = /iPhone|iPad|iPod/i.test(userAgent) || (isMac && maxTouchPoints > 1)
	const id = isIOS ? 'ios' : isMac ? 'macos' : /Windows NT|Win32|Win64/i.test(userAgent) ? 'windows' : undefined
	return platforms.find((platform) => platform.id === id)
}

interface PlatformSelectorProps {
	selectedPlatform: Platform | undefined
	onPlatformChange: (platform: Platform) => void
}

export function PlatformSelector({selectedPlatform, onPlatformChange}: PlatformSelectorProps) {
	const {t} = useTranslation()
	return (
		<div className='flex items-center justify-between'>
			<span className='text-14'>{t('files-share.instructions.how-to-access')}</span>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant='default' className='flex items-center gap-2'>
						{selectedPlatform ? (
							<>
								<img src={selectedPlatform.icon} alt={selectedPlatform.name} className='h-5 w-5' />
								<span>{selectedPlatform.name}</span>
							</>
						) : (
							<span>{t('files-share.instructions.select-platform')}</span>
						)}
						<ChevronDown className='h-3 w-3' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className='w-[200px]'>
					{platforms.map((platform) => (
						<DropdownMenuItem
							key={platform.id}
							className='flex items-center gap-2'
							onClick={() => onPlatformChange(platform)}
						>
							<img src={platform.icon} alt={platform.name} className='h-5 w-5' />
							<span>{platform.name}</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}
