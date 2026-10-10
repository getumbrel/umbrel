import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbPlus, TbRefresh, TbShield, TbX} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {trpcReact} from '@/trpc/trpc'
import {cn} from '@/lib/utils'

import {MDADM_LEVELS, useMdadm, type MdadmArray, type MdadmLevel} from '../hooks/use-mdadm'
import {formatStorageSize} from '../utils'

function memberStateColor(state: string): string {
	switch (state) {
		case 'active':
			return 'text-emerald-400'
		case 'spare':
		case 'sync':
			return 'text-sky-400'
		case 'faulty':
		case 'removed':
			return 'text-destructive2'
		default:
			return 'text-white/50'
	}
}

function ArrayCard({array}: {array: MdadmArray}) {
	const {t} = useTranslation()
	const {removeAsync, failAsync, stopAsync} = useMdadm()
	const [busy, setBusy] = useState<string | null>(null)

	const run = async (key: string, fn: () => Promise<unknown>) => {
		setBusy(key)
		try {
			await fn()
		} finally {
			setBusy(null)
		}
	}

	return (
		<div className='rounded-xl bg-white/5 p-3.5'>
			<div className='flex items-center gap-2'>
				<TbShield className='size-4 text-brand' />
				<span className='text-15 font-semibold text-white'>
					{array.device} · RAID {array.level}
				</span>
				<span
					className={cn(
						'ml-auto rounded-full px-2 py-0.5 text-12 font-medium',
						array.state === 'clean' || array.state === 'active'
							? 'bg-emerald-500/15 text-emerald-400'
							: array.state === 'degraded' || array.state === 'recovering' || array.state === 'resync'
								? 'bg-[#F5A623]/15 text-[#F5A623]'
								: 'bg-white/10 text-white/60',
					)}
				>
					{t(`storage-manager.mdadm.state-${array.state}`, {defaultValue: array.state})}
				</span>
			</div>

			<div className='mt-1 text-13 text-white/50'>
				{t('storage-manager.mdadm.devices-summary', {
					active: array.activeDevices,
					total: array.totalDevices,
					failed: array.failedDevices,
					spare: array.spareDevices,
				})}
				{array.uuid && <> · {array.uuid.slice(0, 8)}</>}
			</div>

			{array.syncProgress !== undefined && (
				<div className='mt-2'>
					<div className='flex justify-between text-12 text-white/60'>
						<span>
							{array.syncAction ?? 'resync'} · {array.syncProgress.toFixed(1)}%
						</span>
					</div>
					<div className='mt-1 h-1.5 overflow-hidden rounded-full bg-white/10'>
						<div className='h-full rounded-full bg-brand transition-all' style={{width: `${array.syncProgress}%`}} />
					</div>
				</div>
			)}

			<div className='mt-2 flex flex-col gap-1.5'>
				{array.members.map((m) => (
					<div key={m.device} className='flex items-center gap-2 text-13'>
						<span className='font-mono text-white/85'>{m.device}</span>
						<span className={cn('font-medium', memberStateColor(m.state))}>
							{t(`storage-manager.mdadm.member-${m.state}`, {defaultValue: m.state})}
						</span>
						<span className='ml-auto flex gap-1'>
							{m.state === 'active' && (
								<button
									type='button'
									disabled={busy !== null}
									onClick={() => run(`fail-${m.device}`, () => failAsync({arrayDevice: array.device, device: m.device}))}
									className='rounded-md border border-white/15 px-2 py-0.5 text-12 text-white/60 hover:bg-white/10 hover:text-white'
								>
									{t('storage-manager.mdadm.fail')}
								</button>
							)}
							{(m.state === 'faulty' || m.state === 'spare') && (
								<button
									type='button'
									disabled={busy !== null}
									onClick={() =>
										run(`remove-${m.device}`, () => removeAsync({arrayDevice: array.device, device: m.device}))
									}
									className='rounded-md border border-white/15 px-2 py-0.5 text-12 text-white/60 hover:bg-white/10 hover:text-white'
								>
									{t('storage-manager.mdadm.remove')}
								</button>
							)}
						</span>
					</div>
				))}
				{array.members.length === 0 && (
					<p className='text-13 text-white/40'>{t('storage-manager.mdadm.no-members')}</p>
				)}
			</div>

			<div className='mt-3 flex gap-2'>
				<button
					type='button'
					disabled={busy !== null}
					onClick={() => run('stop', () => stopAsync({arrayDevice: array.device}))}
					className='rounded-md border border-destructive2/40 px-2.5 py-1 text-12 font-medium text-destructive2 hover:bg-destructive2/10'
				>
					{busy === 'stop' ? t('storage-manager.mdadm.stopping') : t('storage-manager.mdadm.stop')}
				</button>
			</div>
		</div>
	)
}

export function MdadmSection() {
	const {t} = useTranslation()
	const mdadm = useMdadm()
	const devicesQ = trpcReact.hardware.internalStorage.getDevices.useQuery()
	const [createOpen, setCreateOpen] = useState(false)
	const [level, setLevel] = useState<MdadmLevel>('1')
	const [selected, setSelected] = useState<string[]>([])
	const [name, setName] = useState('umbrel-md')

	if (!mdadm.supported && !mdadm.isLoading) {
		return (
			<div className='rounded-xl bg-white/5 p-3.5 text-13 text-white/50'>
				{t('storage-manager.mdadm.not-supported')}
			</div>
		)
	}

	const available = (devicesQ.data ?? []).filter((d) => !d.isSystemDrive && d.device)
	const minDevices = MDADM_LEVELS.find((l) => l.value === level)?.minDevices ?? 2
	const canCreate = selected.length >= minDevices && !mdadm.isCreating

	const toggle = (dev: string) =>
		setSelected((prev) => (prev.includes(dev) ? prev.filter((d) => d !== dev) : [...prev, dev]))

	return (
		<div className='flex flex-col gap-3'>
			<div className='flex items-center gap-2'>
				<h3 className='text-15 font-semibold text-white'>{t('storage-manager.mdadm.title')}</h3>
				<span className='rounded-full bg-white/10 px-2 py-0.5 text-12 text-white/60'>
					{t('storage-manager.mdadm.classic-raid')}
				</span>
				<span className='ml-auto flex gap-2'>
					<button
						type='button'
						onClick={() => {
							void mdadm.refetch()
							void devicesQ.refetch()
						}}
						className='flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-12 text-white/60 hover:bg-white/10 hover:text-white'
					>
						<TbRefresh className='size-3.5' /> {t('storage-manager.mdadm.refresh')}
					</button>
					<button
						type='button'
						onClick={() => mdadm.assembleAsync()}
						className='flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-12 text-white/60 hover:bg-white/10 hover:text-white'
					>
						{t('storage-manager.mdadm.assemble')}
					</button>
					<button
						type='button'
						onClick={() => setCreateOpen(true)}
						className='flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-12 font-semibold text-white hover:brightness-110'
					>
						<TbPlus className='size-3.5' /> {t('storage-manager.mdadm.create')}
					</button>
				</span>
			</div>

			<p className='text-13 leading-relaxed text-white/50'>{t('storage-manager.mdadm.description')}</p>

			{mdadm.isLoading && <p className='text-13 text-white/40'>{t('storage-manager.mdadm.loading')}</p>}
			{mdadm.error && (
				<p className='text-13 text-destructive2'>{t('storage-manager.mdadm.load-error')}</p>
			)}
			{!mdadm.isLoading && mdadm.arrays.length === 0 && (
				<p className='text-13 text-white/40'>{t('storage-manager.mdadm.empty')}</p>
			)}
			{mdadm.arrays.map((array) => (
				<ArrayCard key={array.device} array={array} />
			))}

			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('storage-manager.mdadm.create-title')}</DialogTitle>
					</DialogHeader>
					<div className='flex flex-col gap-3'>
						<label className='flex flex-col gap-1 text-13 text-white/70'>
							{t('storage-manager.mdadm.level')}
							<select
								value={level}
								onChange={(e) => {
									setLevel(e.target.value as MdadmLevel)
									setSelected([])
								}}
								className='rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-white'
							>
								{MDADM_LEVELS.map((l) => (
									<option key={l.value} value={l.value}>
										RAID {l.value} — {t(l.descriptionKey)} (min {l.minDevices})
									</option>
								))}
							</select>
						</label>
						<label className='flex flex-col gap-1 text-13 text-white/70'>
							{t('storage-manager.mdadm.array-name')}
							<input
								value={name}
								onChange={(e) => setName(e.target.value)}
								maxLength={32}
								className='rounded-md border border-white/15 bg-black/40 px-2 py-1.5 font-mono text-white'
							/>
						</label>
						<div className='flex flex-col gap-1.5'>
							<span className='text-13 text-white/70'>
								{t('storage-manager.mdadm.choose-devices', {min: minDevices})}
							</span>
							{available.map((d) => {
								const devPath = `/dev/${d.device}`
								const checked = selected.includes(devPath)
								return (
									<label
										key={d.device}
										className={cn(
											'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-13',
											checked ? 'border-brand bg-brand/10 text-white' : 'border-white/10 text-white/70',
										)}
									>
										<input
											type='checkbox'
											checked={checked}
											onChange={() => toggle(devPath)}
											className='accent-current'
										/>
										<span className='font-mono'>{devPath}</span>
										<span className='text-white/50'>
											{d.name} · {formatStorageSize(d.size)}
										</span>
										{d.isSystemDrive && <TbX className='ml-auto size-4 text-destructive2' />}
									</label>
								)
							})}
							{available.length === 0 && (
								<p className='text-13 text-white/40'>{t('storage-manager.mdadm.no-devices')}</p>
							)}
						</div>
						{mdadm.createError && (
							<p className='text-13 text-destructive2'>{String(mdadm.createError.message)}</p>
						)}
					</div>
					<DialogFooter>
						<Button variant='default' onClick={() => setCreateOpen(false)}>
							{t('cancel')}
						</Button>
						<Button
							variant='primary'
							disabled={!canCreate}
							onClick={async () => {
								await mdadm.createAsync({level, devices: selected, name: name || undefined})
								setCreateOpen(false)
								setSelected([])
							}}
						>
							{mdadm.isCreating
								? t('storage-manager.mdadm.creating')
								: t('storage-manager.mdadm.create-confirm', {count: selected.length})}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
