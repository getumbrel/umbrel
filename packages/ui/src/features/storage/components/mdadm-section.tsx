import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbPlus, TbRefresh, TbShield, TbX} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {cn} from '@/lib/utils'
import {trpcReact} from '@/trpc/trpc'

import {MDADM_LEVELS, useMdadm, type MdadmArray, type MdadmFilesystem, type MdadmLevel} from '../hooks/use-mdadm'
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

function GrowDialog({
	array,
	open,
	onOpenChange,
}: {
	array: MdadmArray
	open: boolean
	onOpenChange: (v: boolean) => void
}) {
	const {t} = useTranslation()
	const mdadm = useMdadm()
	const devicesQ = trpcReact.hardware.internalStorage.getDevices.useQuery()
	const [selected, setSelected] = useState<string[]>([])
	const [targetLevel, setTargetLevel] = useState<string>('')

	const available = (devicesQ.data ?? []).filter((d) => !d.isSystemDrive && d.device)
	const canExpand = array.level === '5' || array.level === '6'
	const toggle = (dev: string) =>
		setSelected((prev) => (prev.includes(dev) ? prev.filter((d) => d !== dev) : [...prev, dev]))

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('storage-manager.mdadm.grow-title', {device: array.device})}</DialogTitle>
				</DialogHeader>
				<div className='flex flex-col gap-3'>
					<p className='text-13 text-white/60'>{t('storage-manager.mdadm.grow-description')}</p>
					{canExpand ? (
						<div className='flex flex-col gap-1.5'>
							<span className='text-13 text-white/70'>{t('storage-manager.mdadm.grow-choose')}</span>
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
									</label>
								)
							})}
							{available.length === 0 && (
								<p className='text-13 text-white/40'>{t('storage-manager.mdadm.no-devices')}</p>
							)}
						</div>
					) : (
						<p className='text-13 text-white/50'>{t('storage-manager.mdadm.grow-unsupported-level')}</p>
					)}
					<label className='flex flex-col gap-1 text-13 text-white/70'>
						{t('storage-manager.mdadm.grow-level-optional')}
						<select
							value={targetLevel}
							onChange={(e) => setTargetLevel(e.target.value)}
							className='rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-white'
						>
							<option value=''>{t('storage-manager.mdadm.grow-keep-level')}</option>
							{['0', '1', '5', '6', '10'].map((lv) => (
								<option key={lv} value={lv}>
									RAID {lv}
								</option>
							))}
						</select>
					</label>
					{(mdadm.growError || mdadm.growExpandError) && (
						<p className='text-13 text-destructive2'>
							{String(mdadm.growExpandError?.message ?? mdadm.growError?.message ?? '')}
						</p>
					)}
				</div>
				<DialogFooter>
					<Button variant='default' onClick={() => onOpenChange(false)}>
						{t('cancel')}
					</Button>
					<Button
						variant='default'
						disabled={mdadm.isGrowMax}
						onClick={async () => {
							await mdadm.growMaxAsync({arrayDevice: array.device})
							onOpenChange(false)
						}}
					>
						{t('storage-manager.mdadm.grow-max')}
					</Button>
					<Button
						variant='primary'
						disabled={(!canExpand || selected.length === 0) && !targetLevel}
						onClick={async () => {
							if (selected.length > 0) {
								await mdadm.growExpandAsync({arrayDevice: array.device, devices: selected})
							} else if (targetLevel) {
								await mdadm.growAsync({arrayDevice: array.device, level: targetLevel as MdadmLevel})
							}
							onOpenChange(false)
							setSelected([])
							setTargetLevel('')
						}}
					>
						{t('storage-manager.mdadm.grow-confirm')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function ArrayCard({array}: {array: MdadmArray}) {
	const {t} = useTranslation()
	const {removeAsync, failAsync, stopAsync, mountAsync, unmountAsync} = useMdadm()
	const [busy, setBusy] = useState<string | null>(null)
	const [growOpen, setGrowOpen] = useState(false)
	const [formatOpen, setFormatOpen] = useState(false)

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
				{` · ${array.raidDevices} raid-devices`}
				{array.filesystem && (
					<span className='text-white/70'>
						{' · '}
						{array.filesystem.label}
						{array.filesystem.native ? '' : ` (${t('storage-manager.mdadm.synthetic')})`}
					</span>
				)}
				{array.mountpoint && <span className='ml-1 text-white/40'>· {array.mountpoint}</span>}
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
									onClick={() =>
										run(`fail-${m.device}`, () => failAsync({arrayDevice: array.device, device: m.device}))
									}
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
				{array.members.length === 0 && <p className='text-13 text-white/40'>{t('storage-manager.mdadm.no-members')}</p>}
			</div>

			<div className='mt-3 flex flex-wrap gap-2'>
				{array.filesystem ? (
					array.mountpoint ? (
						<button
							type='button'
							disabled={busy !== null}
							onClick={() => run('unmount', () => unmountAsync({arrayDevice: array.device}))}
							className='rounded-md border border-white/15 px-2.5 py-1 text-12 font-medium text-white/70 hover:bg-white/10 hover:text-white'
						>
							{t('storage-manager.mdadm.unmount')}
						</button>
					) : (
						<button
							type='button'
							disabled={busy !== null}
							onClick={() => run('mount', () => mountAsync({arrayDevice: array.device}))}
							className='rounded-md border border-white/15 px-2.5 py-1 text-12 font-medium text-white/70 hover:bg-white/10 hover:text-white'
						>
							{t('storage-manager.mdadm.mount')}
						</button>
					)
				) : (
					<button
						type='button'
						onClick={() => setFormatOpen(true)}
						className='rounded-md border border-brand/50 px-2.5 py-1 text-12 font-medium text-brand hover:bg-brand/10'
					>
						{t('storage-manager.mdadm.format')}
					</button>
				)}
				<button
					type='button'
					disabled={busy !== null}
					onClick={() => setGrowOpen(true)}
					className='rounded-md border border-white/15 px-2.5 py-1 text-12 font-medium text-white/70 hover:bg-white/10 hover:text-white'
				>
					{t('storage-manager.mdadm.grow')}
				</button>
				<button
					type='button'
					disabled={busy !== null}
					onClick={() => run('stop', () => stopAsync({arrayDevice: array.device}))}
					className='rounded-md border border-destructive2/40 px-2.5 py-1 text-12 font-medium text-destructive2 hover:bg-destructive2/10'
				>
					{busy === 'stop' ? t('storage-manager.mdadm.stopping') : t('storage-manager.mdadm.stop')}
				</button>
			</div>
			<GrowDialog array={array} open={growOpen} onOpenChange={setGrowOpen} />
			<FormatDialog array={array} open={formatOpen} onOpenChange={setFormatOpen} />
		</div>
	)
}

function FormatDialog({
	array,
	open,
	onOpenChange,
}: {
	array: MdadmArray
	open: boolean
	onOpenChange: (v: boolean) => void
}) {
	const {t} = useTranslation()
	const {filesystems, formatAsync, isFormatting, mountAsync, isMounting} = useMdadm()
	const [filesystem, setFilesystem] = useState<MdadmFilesystem>('ext4')
	const [label, setLabel] = useState('umbrel-md')
	// Each mkfs tool enforces its own label length (FAT-family volumes are 11
	// chars); the backend rejects over-long labels, so cap the input per fs.
	const labelMax = filesystems.find((fs) => fs.value === filesystem)?.labelMax ?? 16

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('storage-manager.mdadm.format-title', {device: array.device})}</DialogTitle>
				</DialogHeader>
				<div className='flex flex-col gap-3'>
					<label className='flex flex-col gap-1 text-13 text-white/70'>
						{t('storage-manager.mdadm.filesystem')}
						<select
							value={filesystem}
							onChange={(e) => {
								const next = e.target.value as MdadmFilesystem
								setFilesystem(next)
								const nextMax = filesystems.find((fs) => fs.value === next)?.labelMax
								if (nextMax) setLabel((current) => current.slice(0, nextMax))
							}}
							className='rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-white'
						>
							{filesystems.map((fs) => (
								<option key={fs.value} value={fs.value}>
									{fs.label}
									{fs.native ? '' : ` — ${t('storage-manager.mdadm.synthetic')}`}
								</option>
							))}
						</select>
					</label>
					<label className='flex flex-col gap-1 text-13 text-white/70'>
						{t('storage-manager.mdadm.label')}
						<input
							value={label}
							onChange={(e) => setLabel(e.target.value.slice(0, labelMax))}
							maxLength={labelMax}
							className='rounded-md border border-white/15 bg-black/40 px-2 py-1.5 font-mono text-white'
						/>
					</label>
					{!filesystems.find((f) => f.value === filesystem)?.native && (
						<p className='rounded-xl bg-[#F5A623]/10 p-3 text-13 text-[#F5A623]'>
							{t('storage-manager.mdadm.synthetic-warning')}
						</p>
					)}
				</div>
				<DialogFooter>
					<Button variant='default' onClick={() => onOpenChange(false)}>
						{t('cancel')}
					</Button>
					<Button
						variant='primary'
						disabled={isFormatting || isMounting}
						onClick={async () => {
							await formatAsync({arrayDevice: array.device, filesystem, label: label || undefined})
							await mountAsync({arrayDevice: array.device})
							onOpenChange(false)
						}}
					>
						{isFormatting || isMounting
							? t('storage-manager.mdadm.formatting')
							: t('storage-manager.mdadm.format-confirm', {fs: filesystem})}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

export function MdadmSection() {
	const {t} = useTranslation()
	const mdadm = useMdadm()
	const devicesQ = trpcReact.hardware.internalStorage.getDevices.useQuery()
	const [createOpen, setCreateOpen] = useState(false)
	const [level, setLevel] = useState<MdadmLevel>('1')
	const [createFilesystem, setCreateFilesystem] = useState<MdadmFilesystem>('ext4')
	const [selected, setSelected] = useState<string[]>([])
	const [name, setName] = useState('umbrel-md')
	const [createFormatError, setCreateFormatError] = useState<string | null>(null)

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
					{t('storage-manager.mdadm.classic-raid')} · {mdadm.arrays.length}
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
						onClick={() => mdadm.assembleAsync({run: true})}
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
			{mdadm.nextDevice && (
				<p className='font-mono text-12 text-white/40'>
					{t('storage-manager.mdadm.next-device', {device: mdadm.nextDevice})}
				</p>
			)}

			{mdadm.isLoading && <p className='text-13 text-white/40'>{t('storage-manager.mdadm.loading')}</p>}
			{mdadm.error && <p className='text-13 text-destructive2'>{t('storage-manager.mdadm.load-error')}</p>}
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
						<p className='font-mono text-12 text-white/40'>
							{t('storage-manager.mdadm.next-device', {device: mdadm.nextDevice ?? '/dev/md?'})}
						</p>
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
							{t('storage-manager.mdadm.filesystem')}
							<select
								value={createFilesystem}
								onChange={(e) => setCreateFilesystem(e.target.value as MdadmFilesystem)}
								className='rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-white'
							>
								{mdadm.filesystems.map((fs) => (
									<option key={fs.value} value={fs.value}>
										{fs.label}
										{fs.native ? '' : ` — ${t('storage-manager.mdadm.synthetic')}`}
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
						{mdadm.createError && <p className='text-13 text-destructive2'>{String(mdadm.createError.message)}</p>}
						{createFormatError && <p className='text-13 text-destructive2'>{createFormatError}</p>}
					</div>
					<DialogFooter>
						<Button variant='default' onClick={() => setCreateOpen(false)}>
							{t('cancel')}
						</Button>
						<Button
							variant='primary'
							disabled={!canCreate}
							onClick={async () => {
								setCreateFormatError(null)
								// createAsync resolves with the allocated /dev/mdN
								const {device} = await mdadm.createAsync({level, devices: selected, name: name || undefined})
								// One-shot: format with the chosen filesystem then mount so the
								// array is immediately usable. The array name doubles as the
								// label, but each mkfs tool has its own label limit, so trim it
								// to fit (e.g. 11 chars for exFAT/FAT32).
								const labelMax = mdadm.filesystems.find((fs) => fs.value === createFilesystem)?.labelMax ?? 32
								const label = name ? name.slice(0, labelMax) : undefined
								try {
									await mdadm.formatAsync({arrayDevice: device, filesystem: createFilesystem, label})
									await mdadm.mountAsync({arrayDevice: device})
									setCreateOpen(false)
									setSelected([])
								} catch (error) {
									// The array exists but formatting/mounting failed. Keep the
									// dialog open so the reason is visible rather than silently
									// leaving an unusable array behind.
									setCreateFormatError(error instanceof Error ? error.message : String(error))
								}
							}}
						>
							{mdadm.isCreating || mdadm.isFormatting
								? t('storage-manager.mdadm.creating')
								: t('storage-manager.mdadm.create-confirm', {count: selected.length})}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
