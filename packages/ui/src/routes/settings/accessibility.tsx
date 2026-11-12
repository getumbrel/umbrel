import * as SliderPrimitive from '@radix-ui/react-slider'
import {useTranslation} from 'react-i18next'

import {useDrawerOrDialog} from '@/components/ui/drawer-or-dialog'
import {Switch} from '@/components/ui/switch'
import {TEXT_SIZES, useIncreaseContrast, useTextSize} from '@/hooks/use-accessibility'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'
import {tw} from '@/utils/tw'

const cardClass = tw`rounded-12 bg-white/6 p-4`

export default function AccessibilityDrawerOrDialog() {
	const {t} = useTranslation()
	const dialogProps = useSettingsDialogProps()
	const {Root, Content, Header, Title, Description, Scroller} = useDrawerOrDialog()
	const [textSize, setTextSize] = useTextSize()
	const [increaseContrast, setIncreaseContrast] = useIncreaseContrast()

	return (
		<Root {...dialogProps}>
			<Content>
				<Header>
					<Title>{t('accessibility')}</Title>
					<Description>{t('accessibility-description')}</Description>
				</Header>
				<Scroller>
					<div className='flex flex-col gap-3'>
						<div className={cardClass}>
							<h3 className='text-14 leading-tight font-medium'>{t('accessibility.text-size')}</h3>
							{/* The two letters are the scale's ends, not text: they keep their size */}
							<div className='mt-2 flex items-center gap-3 font-medium'>
								<span aria-hidden className='text-[13px]'>
									A
								</span>
								<SliderPrimitive.Root
									className='relative flex h-9 flex-1 touch-none items-center select-none'
									min={0}
									max={TEXT_SIZES.length - 1}
									value={[textSize]}
									onValueChange={([index]) => setTextSize(index)}
								>
									<SliderPrimitive.Track className='relative h-1.5 grow rounded-full bg-white/10 contrast-more:bg-white/40'>
										<SliderPrimitive.Range className='absolute h-full rounded-full bg-white' />
										{/* A stop per size, inset by half the thumb so each sits under its centre */}
										<div className='absolute inset-x-3 inset-y-0 flex items-center justify-between'>
											{TEXT_SIZES.map((size, index) => (
												<span
													key={size}
													className={
														index > textSize ? 'size-1 rounded-full bg-white/40 contrast-more:bg-white' : 'size-1'
													}
												/>
											))}
										</div>
									</SliderPrimitive.Track>
									<SliderPrimitive.Thumb
										aria-label={t('accessibility.text-size')}
										// Read out as the body text's size against its default
										aria-valuetext={`${Math.round(((13 + TEXT_SIZES[textSize]) / 13) * 100)}%`}
										className='block size-6 rounded-full bg-white shadow-[0_1px_4px_rgb(0_0_0/0.45)] outline-hidden focus-visible:ring-3 focus-visible:ring-white/40'
									/>
								</SliderPrimitive.Root>
								<span aria-hidden className='text-[21px]'>
									A
								</span>
							</div>
						</div>
						<label className={`${cardClass} flex items-start gap-x-3`}>
							<div className='min-w-0 flex-1 space-y-1'>
								<h3 className='text-14 leading-tight font-medium'>{t('accessibility.increase-contrast')}</h3>
								<p className='text-13 leading-tight text-white/45'>
									{t('accessibility.increase-contrast-description')}
								</p>
							</div>
							<Switch checked={increaseContrast} onCheckedChange={setIncreaseContrast} />
						</label>
					</div>
				</Scroller>
			</Content>
		</Root>
	)
}
