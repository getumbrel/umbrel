import type {AnyTRPCMutationProcedure, AnyTRPCQueryProcedure, inferRouterInputs, inferRouterOutputs} from '@trpc/server'

import type {AppRouter} from './index.js'

// Backward-compatibility ledger for released native clients.
//
// The Apple apps and umbrelOS update independently. These assertions describe
// the wire fields the current iOS and macOS clients send or decode so a server
// change that strands an installed client fails umbreld's normal typecheck.
//
// Compatibility is directional:
// - A payload already shipped by a client must remain accepted by the server.
// - A server response must continue to satisfy the shape that client decodes.
//
// Additive response fields and new optional inputs remain safe. Do not rewrite an
// old requirement merely because the latest client changed; retain it until every
// client that needs it is outside the supported release window.

type Inputs = inferRouterInputs<AppRouter>
type Outputs = inferRouterOutputs<AppRouter>
type Procedures = AppRouter['_def']['record']

type Expect<T extends true> = T
type ServerAccepts<Input, ShippedPayload> = ShippedPayload extends Input ? true : false
type ServerProvides<Actual, ClientShape> = Actual extends ClientShape ? true : false
type IsQuery<Procedure> = Procedure extends AnyTRPCQueryProcedure ? true : false
type IsMutation<Procedure> = Procedure extends AnyTRPCMutationProcedure ? true : false
type IsNonNullish<Value> = null extends Value ? false : undefined extends Value ? false : true

// UmbrelKit sends queries as GET and mutations as POST. Input/output inference
// does not retain that distinction, so pin the operation kind independently.
type _systemVersionMethod = Expect<IsQuery<Procedures['system']['version']>>
type _localHttpsIdentityMethod = Expect<IsQuery<Procedures['system']['localHttpsIdentity']>>
type _discoveryInfoMethod = Expect<IsQuery<Procedures['system']['discoveryInfo']>>
type _ipAddressesMethod = Expect<IsQuery<Procedures['system']['getIpAddresses']>>
type _tailscaleBrowserHostnameMethod = Expect<IsQuery<Procedures['system']['getTailscaleBrowserHostname']>>
type _diskUsageMethod = Expect<IsQuery<Procedures['system']['diskUsage']>>
type _is2faEnabledMethod = Expect<IsQuery<Procedures['user']['is2faEnabled']>>
type _accountsMethod = Expect<IsQuery<Procedures['user']['listAccounts']>>
type _nativeLoginMethod = Expect<IsMutation<Procedures['user']['loginNative']>>
type _nativeRefreshMethod = Expect<IsMutation<Procedures['user']['refreshNativeAccess']>>
type _logoutMethod = Expect<IsMutation<Procedures['user']['logout']>>
type _userMethod = Expect<IsQuery<Procedures['user']['get']>>
type _createPhotoBackupGrantMethod = Expect<IsMutation<Procedures['photos']['createBackupGrant']>>
type _revokePhotoBackupGrantMethod = Expect<IsMutation<Procedures['photos']['revokeBackupGrant']>>
type _confirmedPhotoBackupResourcesMethod = Expect<IsMutation<Procedures['photos']['confirmedBackupResources']>>
type _appsMethod = Expect<IsQuery<Procedures['apps']['list']>>
type _hideCredentialsMethod = Expect<IsMutation<Procedures['apps']['hideCredentialsBeforeOpen']>>
type _appUpdatesMethod = Expect<IsQuery<Procedures['apps']['updates']>>
type _favoritesMethod = Expect<IsQuery<Procedures['files']['favorites']>>
type _sharesMethod = Expect<IsQuery<Procedures['files']['shares']>>
type _sharePasswordMethod = Expect<IsQuery<Procedures['files']['sharePassword']>>
type _addShareMethod = Expect<IsMutation<Procedures['files']['addShare']>>

// MARK: - Device identity and system data

type _systemVersion = Expect<ServerProvides<Outputs['system']['version'], {version: string; name: string}>>
type _localHttpsIdentity = Expect<
	ServerProvides<Outputs['system']['localHttpsIdentity'], {id: string; caCertificate: string}>
>
type _discoveryInfo = Expect<
	ServerProvides<Outputs['system']['discoveryInfo'], {id: string; device: string; onboarded: boolean}>
>
type _ipAddresses = Expect<ServerProvides<Outputs['system']['getIpAddresses'], string[]>>
type _tailscaleBrowserHostname = Expect<ServerProvides<Outputs['system']['getTailscaleBrowserHostname'], string | null>>
type _diskUsage = Expect<
	ServerProvides<
		Outputs['system']['diskUsage'],
		{
			size: number
			totalUsed: number
			system: number
			files: number
			apps: Array<{id: string; used: number}>
			machines?: Array<{id: string; name: string; osId: string; used: number}>
		}
	>
>

// MARK: - Accounts and native sessions

type _is2faEnabled = Expect<ServerProvides<Outputs['user']['is2faEnabled'], boolean>>
type _accounts = Expect<
	ServerProvides<
		Outputs['user']['listAccounts'],
		Array<{
			userId: string
			name: string
			wallpaper: {id: string; brandColorHsl: string}
			avatarUrl?: string | null
		}>
	>
>
type _nativeLoginInput = Expect<
	ServerAccepts<
		Inputs['user']['loginNative'],
		{
			userId: string
			password: string
			totpToken?: string
			client: {
				id: string
				platform: string
				deviceClass: string
				appVersion: string
				appBuild: string
				osVersion: string
			}
		}
	>
>
type _nativeLoginOutput = Expect<
	ServerProvides<
		Outputs['user']['loginNative'],
		{accountId: string; accessToken: string; accessExpiresAt: number; deviceToken: string}
	>
>
type _nativeRefreshInput = Expect<
	ServerAccepts<
		Inputs['user']['refreshNativeAccess'],
		{
			deviceToken: string
			client: {
				id: string
				platform: string
				deviceClass: string
				appVersion: string
				appBuild: string
				osVersion: string
			}
		}
	>
>
type _nativeRefreshOutput = Expect<
	ServerProvides<Outputs['user']['refreshNativeAccess'], {accessToken: string; accessExpiresAt: number}>
>
type _logout = Expect<ServerProvides<Outputs['user']['logout'], boolean>>
type _user = Expect<
	ServerProvides<
		Outputs['user']['get'],
		{
			userId: string
			name: string
			role: string
			homePath: string
			wallpaper: {id: string; brandColorHsl: string}
		}
	>
>

// MARK: - Photo backup grants

type _createPhotoBackupGrantInput = Expect<
	ServerAccepts<Inputs['photos']['createBackupGrant'], {sourceId: string; suggestedName: string}>
>
type _createPhotoBackupGrantOutput = Expect<
	ServerProvides<
		Outputs['photos']['createBackupGrant'],
		{token: string; source: {id: string; accountId: string; name: string}}
	>
>
type _revokePhotoBackupGrant = Expect<ServerProvides<Outputs['photos']['revokeBackupGrant'], boolean>>
type _confirmedPhotoBackupResourcesInput = Expect<
	ServerAccepts<
		Inputs['photos']['confirmedBackupResources'],
		{sourceId: string; resources: Array<{resourceKey: string; fileExtension: string}>}
	>
>
type _confirmedPhotoBackupResourcesOutput = Expect<
	ServerProvides<Outputs['photos']['confirmedBackupResources'], Array<{resourceKey: string; bytes: number}>>
>

// MARK: - Apps

// apps.list returns either a full app or an {id, error} stub. The client requires
// id on both arms and decodes the remaining fields only from the full arm.
type InstalledApp = Extract<Outputs['apps']['list'][number], {name: unknown}>
type _appId = Expect<ServerProvides<Outputs['apps']['list'][number], {id: string}>>
type _app = Expect<
	ServerProvides<
		Pick<
			InstalledApp,
			| 'id'
			| 'name'
			| 'version'
			| 'icon'
			| 'state'
			| 'progress'
			| 'port'
			| 'path'
			| 'torOnly'
			| 'requiresHttps'
			| 'credentials'
		>,
		{
			id: string
			name: string
			version: string
			icon: string
			state: string
			progress: number
			port: number
			path?: string
			torOnly?: boolean
			requiresHttps?: boolean
			credentials?: {
				defaultUsername?: string
				defaultPassword?: string
				showBeforeOpen?: boolean
			}
		}
	>
>
type _hideCredentialsInput = Expect<
	ServerAccepts<Inputs['apps']['hideCredentialsBeforeOpen'], {appId: string; value: true}>
>
// UmbrelKit intentionally ignores this value, but its generic tRPC envelope still
// requires a concrete JSON value rather than null or an omitted data property.
type _hideCredentialsOutput = Expect<IsNonNullish<Outputs['apps']['hideCredentialsBeforeOpen']>>
type _appUpdates = Expect<ServerProvides<Outputs['apps']['updates'], Array<{id: string; version: string}>>>

// MARK: - Files and Finder shares

type _favorites = Expect<ServerProvides<Outputs['files']['favorites'], string[]>>
type _shares = Expect<
	ServerProvides<Outputs['files']['shares'], Array<{name: string; path: string; sharename: string}>>
>
type _sharePassword = Expect<ServerProvides<Outputs['files']['sharePassword'], string>>
type _addShareInput = Expect<ServerAccepts<Inputs['files']['addShare'], {path: string}>>
type _addShareOutput = Expect<IsNonNullish<Outputs['files']['addShare']>>
