import {useTranslation} from 'react-i18next'

import androidIcon from '@/features/files/assets/android-phone-icon-128.webp'
import externalStorageIcon from '@/features/files/assets/external-storage-icon.png'
import iphoneIcon from '@/features/files/assets/iphone-icon-128.webp'
import nasIcon from '@/features/files/assets/nas-icon-active.png'
import type {SourceType} from '@/features/photos/hooks/use-photo-sources'
import {cn} from '@/lib/utils'

// The add dialog's coming-soon cards still draw the post-v1 device kinds, so
// the icon keeps their artwork beyond the API's own SourceType
type IconType = SourceType | 'external-drive' | 'network-share'

// Same device artwork the Files sidebar uses for drives, NAS and phones; the
// umbrelOS mark for this device. `size` is the box in px.
export function SourceIcon({type, size = 20, className}: {type: IconType; size?: number; className?: string}) {
	const {t} = useTranslation()
	const box = {width: size, height: size}
	switch (type) {
		case 'umbrel':
			return (
				<img
					src='/assets/umbrel-ios.png'
					alt='umbrelOS'
					style={{...box, borderRadius: Math.round(size * 0.23)}}
					className={cn('shrink-0', className)}
					draggable={false}
				/>
			)
		case 'external-drive':
			return (
				<img
					src={externalStorageIcon}
					alt={t('external-drive')}
					style={box}
					className={cn('shrink-0', className)}
					draggable={false}
				/>
			)
		case 'network-share':
			return <img src={nasIcon} alt='NAS' style={box} className={cn('shrink-0', className)} draggable={false} />
		case 'iphone':
			return <img src={iphoneIcon} alt='iPhone' style={box} className={cn('shrink-0', className)} draggable={false} />
		case 'android':
			return <img src={androidIcon} alt='Android' style={box} className={cn('shrink-0', className)} draggable={false} />
	}
}
