import {useState} from 'react'
import {IoShieldHalf} from 'react-icons/io5'
import {TbInfoCircle, TbServer} from 'react-icons/tb'

import {Button} from '@/shadcn-components/ui/button'
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@/shadcn-components/ui/dialog'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

import {RaidType} from '../hooks/use-storage'

// i18n keys used dynamically via modeOptions[].titleKey, descriptionKey, etc:
// t('storage-manager.mode.full-storage')
// t('storage-manager.mode.full-storage.description')
// t('storage-manager.mode.full-storage.info-title')
// t('storage-manager.mode.full-storage.info-description')
// t('storage-manager.mode.failsafe')
// t('storage-manager.mode.failsafe.description')
// t('storage-manager.mode.failsafe.info-title')
// t('storage-manager.mode.failsafe.info-description')

type ModeOption = {
	id: RaidType
	icon: React.ReactNode
	titleKey: string
	descriptionKey: string
	infoTitleKey: string
	infoDescriptionKey: string
}

const modeOptions: ModeOption[] = [
	{
		id: 'storage',
		icon: <TbServer className='size-5' />,
		titleKey: 'storage-manager.mode.full-storage',
		descriptionKey: 'storage-manager.mode.full-storage.description',
		infoTitleKey: 'storage-manager.mode.full-storage.info-title',
		infoDescriptionKey: 'storage-manager.mode.full-storage.info-description',
	},
	{
		id: 'failsafe',
		icon: <IoShieldHalf className='size-5' />,
		titleKey: 'storage-manager.mode.failsafe',
		descriptionKey: 'storage-manager.mode.failsafe.description',
		infoTitleKey: 'storage-manager.mode.failsafe.info-title',
		infoDescriptionKey: 'storage-manager.mode.failsafe.info-description',
	},
]

type StorageModeDisplayProps = {
	value: RaidType
	canEnableFailsafe: boolean
}

export function StorageModeDisplay({value, canEnableFailsafe}: StorageModeDisplayProps) {
	const [infoDialogOption, setInfoDialogOption] = useState<ModeOption | null>(null)

	// Dynamic "why not available" messages based on current state
	const getWhyNotAvailable = (optionId: RaidType): string | null => {
		if (optionId === 'storage' && value === 'failsafe') {
			return t('storage-manager.mode.switch-from-failsafe-unavailable')
		}
		if (optionId === 'failsafe' && value === 'storage') {
			// User has 1 SSD so they CAN enable FailSafe by adding more drives
			if (canEnableFailsafe) return null

			// User has 2+ SSDs in storage mode so cannot enable FailSafe
			return t('storage-manager.mode.switch-to-failsafe-unavailable')
		}
		return null
	}

	// We show a "why can't I switch" message if applicable
	const whyNotAvailable = infoDialogOption ? getWhyNotAvailable(infoDialogOption.id) : null

	return (
		<>
			{/* Mobile: Compact row showing both modes */}
			<div className='flex gap-2 rounded-24 bg-white/5 p-2 md:hidden'>
				{modeOptions.map((option) => {
					const isSelected = value === option.id
					return (
						<button
							key={option.id}
							type='button'
							onClick={() => setInfoDialogOption(option)}
							className={cn(
								'flex flex-1 items-center justify-center gap-2 rounded-17 border px-3 py-2.5 transition-colors',
								isSelected ? 'border-brand bg-brand/15' : 'border-transparent opacity-50',
							)}
						>
							<span className={cn(isSelected ? 'text-white' : 'text-white/80')}>{option.icon}</span>
							<span className={cn('text-13 font-semibold', isSelected ? 'text-white' : 'text-white/80')}>
								{t(option.titleKey)}
							</span>
						</button>
					)
				})}
			</div>

			{/* Desktop: Show both modes with descriptions */}
			<div className='hidden rounded-24 bg-white/5 p-2 md:block'>
				<div className='grid grid-cols-2 gap-2'>
					{modeOptions.map((option) => {
						const isSelected = value === option.id
						return (
							<div
								key={option.id}
								className={cn(
									'flex flex-col gap-2 rounded-17 border px-4 py-3 text-left',
									isSelected ? 'border-brand bg-brand/15' : 'border-transparent opacity-50',
								)}
							>
								<div className='flex items-center gap-2'>
									<span className={cn(isSelected ? 'text-white' : 'text-white/80')}>{option.icon}</span>
									<span className={cn('text-15 font-semibold', isSelected ? 'text-white' : 'text-white/80')}>
										{t(option.titleKey)}
									</span>
									<button
										type='button'
										onClick={() => setInfoDialogOption(option)}
										className='-ml-1 text-white/40 transition-colors hover:text-white/60'
									>
										<TbInfoCircle className='size-4' />
									</button>
								</div>
								<p className='text-13 leading-snug font-medium text-white/60'>{t(option.descriptionKey)}</p>
							</div>
						)
					})}
				</div>
			</div>

			{/* Info Dialog */}
			<Dialog open={infoDialogOption !== null} onOpenChange={(open) => !open && setInfoDialogOption(null)}>
				<DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
					<DialogHeader>
						<div className='flex items-center gap-2'>
							{infoDialogOption?.icon}
							<DialogTitle>{infoDialogOption && t(infoDialogOption.infoTitleKey)}</DialogTitle>
						</div>
					</DialogHeader>

					<div className='space-y-4'>
						<p className='text-13 leading-relaxed text-white/70'>
							{infoDialogOption && t(infoDialogOption.infoDescriptionKey)}
						</p>

						{whyNotAvailable && (
							<div className='rounded-12 bg-white/6 p-3'>
								<p className='text-13 font-medium text-white/50'>
									<span className='text-white/70'>{t('storage-manager.mode.why-cant-switch')}</span>
									<br />
									{whyNotAvailable}
								</p>
							</div>
						)}
					</div>

					<DialogFooter>
						<Button variant='default' onClick={() => setInfoDialogOption(null)}>
							{t('done')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
