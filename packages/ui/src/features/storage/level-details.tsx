// The modes of FailSafe side by side, for whoever wants to weigh them: in setup under the
// choice of a mode, and in Storage Manager under the list of them.

import {Fragment} from 'react'

import {cn} from '@/lib/utils'

import {LevelGlyph} from './art'
import {FailsafeLayout, layoutTech} from './model'
import {Disclosure} from './parts'
import {useStorageTranslation} from './words'

// The expert's corner: everything that was deliberately left out of the choices above, level
// beside level. A table where there is room for one, a block per level on a phone. The level
// that is chosen is the column, or the block, that is lit.
export function LevelDetails({layouts, selected}: {layouts: FailsafeLayout[]; selected: FailsafeLayout | null}) {
	const {t} = useStorageTranslation()
	if (layouts.length < 2) return null
	const facts = ['fail', 'add', 'sizes', 'repair'] as const
	// Each level drawn as the smallest storage it makes
	const smallest: Record<FailsafeLayout, number> = {raidz1: 3, raidz2: 4, mirror: 4}
	const lit = 'bg-brand/[0.13]'
	const head = (layout: FailsafeLayout) => (
		<>
			<LevelGlyph layout={layout} count={smallest[layout]} className='h-4' />
			<span className='text-13 leading-tight font-semibold text-white/90'>
				{t(`storage-setup.compare.head.${layout}`)}
			</span>
			<span className='font-mono text-[10px] leading-none tracking-tight text-white/40'>{layoutTech[layout]}</span>
		</>
	)
	return (
		<Disclosure summary={t('storage-setup.compare')} plain>
			<div className='overflow-hidden rounded-17 bg-white/5'>
				<table className='hidden w-full table-fixed border-separate border-spacing-0 text-left @[400px]:table'>
					<colgroup>
						<col className='w-[23%]' />
						{layouts.map((layout) => (
							<col key={layout} />
						))}
					</colgroup>
					<thead>
						<tr>
							<td className='pt-2' />
							{layouts.map((layout) => (
								<td key={layout} className='px-1.5 pt-2'>
									<span className={cn('block h-2.5 rounded-t-12', layout === selected && lit)} />
								</td>
							))}
						</tr>
						<tr>
							<th />
							{layouts.map((layout) => (
								<th key={layout} scope='col' className='px-1.5 align-top font-normal'>
									<span className={cn('flex flex-col gap-1.5 px-2.5 pb-3.5', layout === selected && lit)}>
										{head(layout)}
									</span>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{facts.map((fact) => (
							<tr key={fact}>
								<th
									scope='row'
									className='border-t border-white/[0.07] py-2.5 pr-2 pl-4 align-top text-12 leading-[18px] font-normal text-white/45'
								>
									{t(`storage-setup.compare.${fact}`)}
								</th>
								{layouts.map((layout) => (
									// The cell keeps the hairline, and the tint sits in a block inside it, so the lit
									// column is one rounded shape with the lines running through it
									<td key={layout} className='h-px border-t border-white/[0.07] px-1.5 align-top'>
										<span
											className={cn(
												'block h-full px-2.5 py-2.5 text-13 leading-[18px] text-balance text-white/80',
												layout === selected && lit,
											)}
										>
											{t(`storage-setup.compare.${fact}.${layout}`)}
										</span>
									</td>
								))}
							</tr>
						))}
						<tr>
							<td className='pb-2' />
							{layouts.map((layout) => (
								<td key={layout} className='px-1.5 pb-2'>
									<span className={cn('block h-2.5 rounded-b-12', layout === selected && lit)} />
								</td>
							))}
						</tr>
					</tbody>
				</table>

				<div className='flex flex-col gap-1.5 p-1.5 @[400px]:hidden'>
					{layouts.map((layout) => (
						<div key={layout} className={cn('flex flex-col gap-2.5 rounded-12 px-3 py-3', layout === selected && lit)}>
							<span className='flex flex-col gap-1.5'>{head(layout)}</span>
							<dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-12 leading-snug'>
								{facts.map((fact) => (
									<Fragment key={fact}>
										<dt className='text-white/45'>{t(`storage-setup.compare.${fact}`)}</dt>
										<dd className='text-right text-white/80'>{t(`storage-setup.compare.${fact}.${layout}`)}</dd>
									</Fragment>
								))}
							</dl>
						</div>
					))}
				</div>

				<p className='border-t border-white/[0.07] px-4 py-3 text-12 leading-relaxed text-white/45'>
					{t('storage-setup.compare.rebuild')}
				</p>
			</div>
		</Disclosure>
	)
}

// Drives are only ever changed with the machine off
