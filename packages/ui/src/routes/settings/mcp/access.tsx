import {PlusCircle} from 'lucide-react'
import {AnimatePresence} from 'motion/react'
import {lazy, Suspense, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {AppIcon} from '@/components/app-icon'
import {Button} from '@/components/ui/button'
import {SearchablePicker} from '@/components/ui/searchable-picker'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {useHomeDirectoryName} from '@/features/files/hooks/use-home-directory-name'
import {MachineAppIcon} from '@/features/machines/components/machine-app-icon'
import type {Machine} from '@/features/machines/types'
import {cn} from '@/lib/utils'
import {
	AnimatedRow,
	EmptyCard,
	RowRemoveButton,
	ShareAllToggle,
	ShareEveryoneRow,
	shareListClass,
} from '@/modules/user-sharing'
import {isStorageCategoryPath} from '@/modules/user-sharing/new-user-access'
import {BackButton, Divider, SectionLabel} from '@/routes/settings/_components/shared'
import {RouterOutput} from '@/trpc/trpc'

const MiniBrowser = lazy(() =>
	import('@/features/files/components/mini-browser').then((module) => ({default: module.MiniBrowser})),
)

export type McpPermissions = RouterOutput['mcp']['getSettings']['permissions']
export type InstalledApp = {id: string; name: string; icon?: string}

// ─── App access drill-in ────────────────────────────────────────────
// Deliberately mirrors the member-sharing surfaces in users.tsx — the product
// metaphor is "like sharing with a member, but it's your agent".

export function AppAccessDetail({
	permissions,
	installedApps,
	busy,
	onUpdate,
	onBack,
}: {
	permissions: McpPermissions
	installedApps: InstalledApp[]
	busy: boolean
	onUpdate: (patch: Partial<McpPermissions>) => void
	onBack: () => void
}) {
	const {t} = useTranslation()

	const allApps = permissions.apps === 'all'
	const grantedAppIds = permissions.apps === 'all' ? [] : permissions.apps
	const appById = new Map(installedApps.map((app) => [app.id, app]))
	const availableApps = installedApps.filter((app) => !grantedAppIds.includes(app.id))

	const addAppMenu = (
		<SearchablePicker
			placeholder={t('app-picker.search')}
			items={availableApps.map((app) => ({
				value: app.id,
				label: app.name || app.id,
				icon: <AppIcon size={24} src={app.icon} className='shrink-0 rounded-6' />,
			}))}
			onSelect={(id) => onUpdate({apps: [...grantedAppIds, id]})}
		>
			<Button size='sm' aria-label={t('mcp-add-app')} disabled={availableApps.length === 0 || busy}>
				{t('mcp-add')}
				<PlusCircle className='h-3 w-3' />
			</Button>
		</SearchablePicker>
	)

	return (
		<div className='flex flex-col gap-y-5'>
			<BackButton onClick={onBack}>{t('mcp')}</BackButton>

			<section className='flex flex-col gap-2'>
				<div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-2'>
					<div className='text-15 font-semibold -tracking-2'>{t('mcp-apps')}</div>
					<div className='flex items-center gap-3'>
						<ShareAllToggle
							label={t('mcp-all-apps')}
							tooltip={t('mcp-all-apps-description')}
							checked={allApps}
							disabled={busy}
							className={cn(busy && 'umbrel-pulse')}
							onCheckedChange={(checked) => onUpdate({apps: checked ? 'all' : []})}
						/>
						{!allApps && addAppMenu}
					</div>
				</div>
				<p className='text-12 leading-tight text-white/35'>{t('mcp-app-access-description')}</p>
				{allApps ? (
					<EmptyCard>{t('mcp-all-apps-active')}</EmptyCard>
				) : grantedAppIds.length === 0 ? (
					<EmptyCard>{t('mcp-no-apps')}</EmptyCard>
				) : (
					<div className={shareListClass()}>
						<AnimatePresence initial={false}>
							{grantedAppIds.map((appId) => (
								<AnimatedRow key={appId}>
									<div className='flex items-center gap-3 p-3'>
										<AppIcon size={32} src={appById.get(appId)?.icon} className='shrink-0 rounded-8' />
										<span className='min-w-0 flex-1 truncate text-13 font-medium -tracking-2 text-white/90'>
											{appById.get(appId)?.name ?? appId}
										</span>
										<RowRemoveButton
											label={t('mcp-remove-app', {name: appById.get(appId)?.name ?? appId})}
											disabled={busy}
											onClick={() => onUpdate({apps: grantedAppIds.filter((id) => id !== appId)})}
										/>
									</div>
								</AnimatedRow>
							))}
						</AnimatePresence>
					</div>
				)}
			</section>
		</div>
	)
}

// ─── Machine access drill-in ────────────────────────────────────────
// The same shape as app access: a machine grant hands the agent the whole
// machine, screen and input included.

export function MachineAccessDetail({
	permissions,
	machines,
	busy,
	onUpdate,
	onBack,
}: {
	permissions: McpPermissions
	machines: Machine[]
	busy: boolean
	onUpdate: (patch: Partial<McpPermissions>) => void
	onBack: () => void
}) {
	const {t} = useTranslation()

	const allMachines = permissions.machines === 'all'
	const grantedMachineIds = permissions.machines === 'all' ? [] : permissions.machines
	const machineById = new Map(machines.map((machine) => [machine.id, machine]))
	const availableMachines = machines.filter((machine) => !grantedMachineIds.includes(machine.id))

	const addMachineMenu = (
		<SearchablePicker
			placeholder={t('app-picker.search')}
			items={availableMachines.map((machine) => ({
				value: machine.id,
				label: machine.name,
				icon: <MachineAppIcon osId={machine.osId} state={machine.state} className='size-6' />,
			}))}
			onSelect={(id) => onUpdate({machines: [...grantedMachineIds, id]})}
		>
			<Button size='sm' aria-label={t('mcp-add-machine')} disabled={availableMachines.length === 0 || busy}>
				{t('mcp-add')}
				<PlusCircle className='h-3 w-3' />
			</Button>
		</SearchablePicker>
	)

	return (
		<div className='flex flex-col gap-y-5'>
			<BackButton onClick={onBack}>{t('mcp')}</BackButton>

			<section className='flex flex-col gap-2'>
				<div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-2'>
					<div className='text-15 font-semibold -tracking-2'>{t('mcp-machines')}</div>
					<div className='flex items-center gap-3'>
						<ShareAllToggle
							label={t('mcp-all-machines')}
							tooltip={t('mcp-all-machines-description')}
							checked={allMachines}
							disabled={busy}
							className={cn(busy && 'umbrel-pulse')}
							onCheckedChange={(checked) => onUpdate({machines: checked ? 'all' : []})}
						/>
						{!allMachines && addMachineMenu}
					</div>
				</div>
				<p className='text-12 leading-tight text-white/35'>{t('mcp-machine-access-description')}</p>
				{allMachines ? (
					<EmptyCard>{t('mcp-all-machines-active')}</EmptyCard>
				) : grantedMachineIds.length === 0 ? (
					<EmptyCard>{t('mcp-no-machines')}</EmptyCard>
				) : (
					<div className={shareListClass()}>
						<AnimatePresence initial={false}>
							{grantedMachineIds.map((machineId) => (
								<AnimatedRow key={machineId}>
									<div className='flex items-center gap-3 p-3'>
										<MachineAppIcon
											osId={machineById.get(machineId)?.osId ?? 'custom'}
											state={machineById.get(machineId)?.state}
											className='size-8'
										/>
										<span className='min-w-0 flex-1 truncate text-13 font-medium -tracking-2 text-white/90'>
											{machineById.get(machineId)?.name ?? machineId}
										</span>
										<RowRemoveButton
											label={t('mcp-remove-machine', {name: machineById.get(machineId)?.name ?? machineId})}
											disabled={busy}
											onClick={() => onUpdate({machines: grantedMachineIds.filter((id) => id !== machineId)})}
										/>
									</div>
								</AnimatedRow>
							))}
						</AnimatePresence>
					</div>
				)}
			</section>
		</div>
	)
}

// ─── File access drill-in ───────────────────────────────────────────

export function FileAccessDetail({
	permissions,
	busy,
	onUpdate,
	onBack,
}: {
	permissions: McpPermissions
	busy: boolean
	onUpdate: (patch: Partial<McpPermissions>) => void
	onBack: () => void
}) {
	const {t} = useTranslation()
	const homeDirectoryName = useHomeDirectoryName()

	const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false)

	const allFolders = permissions.files === 'all'
	const grantedFolders = permissions.files === 'all' ? [] : permissions.files

	// External and Network are whole-category grants surfaced as storage
	// toggles (like the users dialog), not ordinary folder rows
	const folderGrants = grantedFolders.filter((path) => !isStorageCategoryPath(path))
	const toggleStorageGrant = (path: '/External' | '/Network', granted: boolean) =>
		onUpdate({files: granted ? [...grantedFolders, path] : grantedFolders.filter((item) => item !== path)})

	const folderDisplayName = (path: string) =>
		path === '/Home' ? homeDirectoryName : (path.split('/').filter(Boolean).pop() ?? path)
	const folderFullPath = (path: string) =>
		path
			.split('/')
			.filter(Boolean)
			.map((segment, index) => (index === 0 && segment === 'Home' ? homeDirectoryName : segment))
			.join(' › ')

	return (
		<div className='flex flex-col gap-y-5'>
			<BackButton onClick={onBack}>{t('mcp')}</BackButton>

			<section className='flex flex-col gap-2'>
				<div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-2'>
					<div className='text-15 font-semibold -tracking-2'>{t('mcp-folders')}</div>
					<div className='flex items-center gap-3'>
						<ShareAllToggle
							label={t('mcp-all-folders')}
							tooltip={t('mcp-all-folders-description')}
							checked={allFolders}
							disabled={busy}
							className={cn(busy && 'umbrel-pulse')}
							onCheckedChange={(checked) => onUpdate({files: checked ? 'all' : []})}
						/>
						{!allFolders && (
							<Button
								size='sm'
								aria-label={t('mcp-add-folder')}
								disabled={busy}
								onClick={() => setIsFolderPickerOpen(true)}
							>
								{t('mcp-add')}
								<PlusCircle className='h-3 w-3' />
							</Button>
						)}
					</div>
				</div>
				<p className='text-12 leading-tight text-white/35'>{t('mcp-file-access-description')}</p>
				{allFolders ? (
					<EmptyCard>{t('mcp-all-folders-active')}</EmptyCard>
				) : folderGrants.length === 0 ? (
					<EmptyCard>{t('mcp-no-folders')}</EmptyCard>
				) : (
					<div className={shareListClass()}>
						<AnimatePresence initial={false}>
							{folderGrants.map((path) => (
								<AnimatedRow key={path}>
									<div className='flex items-center gap-3 p-3'>
										<FileItemIcon
											item={{
												name: folderDisplayName(path),
												path,
												type: 'directory',
												modified: 0,
												size: 0,
												operations: [],
											}}
											className='size-8 shrink-0'
										/>
										<div className='min-w-0 flex-1'>
											<div className='truncate text-13 font-medium -tracking-2 text-white/90'>
												{folderDisplayName(path)}
											</div>
											{/* rtl + bdi truncates from the left so the deepest folders stay visible */}
											<div dir='rtl' className='truncate text-left text-11 text-white/35'>
												<bdi>{folderFullPath(path)}</bdi>
											</div>
										</div>
										<RowRemoveButton
											label={t('mcp-remove-folder', {name: folderDisplayName(path)})}
											disabled={busy}
											onClick={() => onUpdate({files: grantedFolders.filter((item) => item !== path)})}
										/>
									</div>
								</AnimatedRow>
							))}
						</AnimatePresence>
					</div>
				)}
			</section>

			<Divider />

			<section className='flex flex-col gap-2'>
				<SectionLabel>{t('mcp-storage-access')}</SectionLabel>
				<div className={shareListClass()}>
					<ShareEveryoneRow
						className='p-3'
						title={t('mcp-usb-storage')}
						description={t('mcp-usb-storage-description')}
						checked={allFolders || grantedFolders.includes('/External')}
						disabled={busy || allFolders}
						onCheckedChange={(checked) => toggleStorageGrant('/External', checked)}
					/>
					<ShareEveryoneRow
						className='border-t border-white/6 p-3'
						title={t('mcp-network-storage')}
						description={t('mcp-network-storage-description')}
						checked={allFolders || grantedFolders.includes('/Network')}
						disabled={busy || allFolders}
						onCheckedChange={(checked) => toggleStorageGrant('/Network', checked)}
					/>
				</div>
			</section>

			<Suspense>
				{isFolderPickerOpen && (
					<MiniBrowser
						open={isFolderPickerOpen}
						onOpenChange={setIsFolderPickerOpen}
						rootPath='/Home'
						selectionMode='folders'
						preselectOnOpen={false}
						disabledPaths={folderGrants}
						title={t('mcp-add-folder')}
						onSelect={(path) => {
							setIsFolderPickerOpen(false)
							onUpdate({files: [...grantedFolders, path]})
						}}
					/>
				)}
			</Suspense>
		</div>
	)
}
