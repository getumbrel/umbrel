import type {AnyTRPCMutationProcedure, AnyTRPCQueryProcedure, inferRouterInputs, inferRouterOutputs} from '@trpc/server'

import type {APP_GATEWAY_HTTPS_COOKIE_NAME} from '../../auth/app-gateway-cookie.ts'
import type {BROWSER_SESSION_HTTPS_COOKIE_NAME} from '../../auth/browser-session-cookie.ts'
import type {AppRouter} from './index.ts'

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
type _internalStorageDevicesMethod = Expect<IsQuery<Procedures['hardware']['internalStorage']['getDevices']>>
type _is2faEnabledMethod = Expect<IsQuery<Procedures['user']['is2faEnabled']>>
type _accountsMethod = Expect<IsQuery<Procedures['user']['listAccounts']>>
type _nativeLoginMethod = Expect<IsMutation<Procedures['user']['loginNative']>>
type _nativeRefreshMethod = Expect<IsMutation<Procedures['user']['refreshNativeAccess']>>
type _logoutMethod = Expect<IsMutation<Procedures['user']['logout']>>
type _browserLoginMethod = Expect<IsMutation<Procedures['user']['login']>>
type _browserRenewMethod = Expect<IsMutation<Procedures['user']['renewToken']>>
type _userMethod = Expect<IsQuery<Procedures['user']['get']>>
type _createPhotoBackupGrantMethod = Expect<IsMutation<Procedures['photos']['createBackupGrant']>>
type _revokePhotoBackupGrantMethod = Expect<IsMutation<Procedures['photos']['revokeBackupGrant']>>
type _confirmedPhotoBackupResourcesMethod = Expect<IsMutation<Procedures['photos']['confirmedBackupResources']>>
type _photoBackupSourcesMethod = Expect<IsQuery<Procedures['photos']['backupSources']>>
type _photoSourcesMethod = Expect<IsQuery<Procedures['photos']['sources']['list']>>
type _appsMethod = Expect<IsQuery<Procedures['apps']['list']>>
type _hideCredentialsMethod = Expect<IsMutation<Procedures['apps']['hideCredentialsBeforeOpen']>>
type _appUpdatesMethod = Expect<IsQuery<Procedures['apps']['updates']>>
type _favoritesMethod = Expect<IsQuery<Procedures['files']['favorites']>>
type _sharesMethod = Expect<IsQuery<Procedures['files']['shares']>>
type _sharePasswordMethod = Expect<IsQuery<Procedures['files']['sharePassword']>>
type _addShareMethod = Expect<IsMutation<Procedures['files']['addShare']>>

// MARK: - Device identity and system data

type _systemVersion = Expect<ServerProvides<Outputs['system']['version'], {version: string; name: string}>>
// Also UmbrelKit's identity and liveness check for saved routes (HTTPS) and the in-app
// browser's route (HTTP or HTTPS), with short timeouts: keep it public and cheap
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
// Before first-time setup, the iOS app checks for drives umbrelOS would offer for
// RAID. RAID setup restarts the Umbrel onto those drives, so the app sends it to a
// browser instead of running it in the app.
type _internalStorageDeviceId = Expect<
	ServerProvides<Outputs['hardware']['internalStorage']['getDevices'][number]['id'], string | undefined>
>
type _internalStorageSystemDrive = Expect<
	ServerProvides<Outputs['hardware']['internalStorage']['getDevices'][number]['isSystemDrive'], boolean | undefined>
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

// MARK: - In-app browser sessions
//
// The iOS app shows umbrelOS and its apps in an in-app browser. At sign-in it also
// logs in the way a browser does, then replays the result into its web view: the
// returned dashboard token goes into localStorage under `umbrel-auth-token`, and
// the browser-session and app-gateway cookies are set for whichever of the
// Umbrel's addresses is in use. Beyond these shapes it relies on the HTTPS cookie
// names pinned below, on credentials not rotating on renewal, on renewToken
// answering 401 or 403 once a session has ended, and on one 2FA code being accepted
// for both the native login and this one (sign-in sends the same code to each). A
// client without a usable session falls back to umbrelOS's own login page, so a
// break here costs a second sign-in rather than access.
type _browserLoginInput = Expect<
	ServerAccepts<Inputs['user']['login'], {userId: string; password: string; totpToken?: string}>
>
type _browserLoginOutput = Expect<ServerProvides<Outputs['user']['login'], string>>
type _browserRenewOutput = Expect<ServerProvides<Outputs['user']['renewToken'], string>>
type _browserSessionCookieName = Expect<
	ServerProvides<typeof BROWSER_SESSION_HTTPS_COOKIE_NAME, '__Host-UMBREL_BROWSER_SESSION_HTTPS'>
>
type _appGatewayCookieName = Expect<
	ServerProvides<typeof APP_GATEWAY_HTTPS_COOKIE_NAME, '__Host-UMBREL_APP_SESSION_HTTPS'>
>
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
	ServerAccepts<Inputs['photos']['createBackupGrant'], {sourceId: string; suggestedName: string; continuing?: boolean}>
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
// On umbrelOS without backupSources, the iOS app reads the account's iPhone backups here
// to give a new one a name none of them has. It also finds its own source by id, to show
// the name it has in Photos after a rename there. It derives that id itself
// (backupLibrarySourceId), which a type can't pin; a unit test does.
type _photoSourcesOutput = Expect<
	ServerProvides<
		Outputs['photos']['sources']['list'],
		Array<{id: string; type: string; name: string; lastImportAt?: number; stats: {photos: number; videos: number}}>
	>
>

// An iPhone restored from another, or moved over by Quick Start, continues its
// backup without uploading what that backup already has. Clients detect support
// through backupSources: a server without it answers 404 and has none of its
// capabilities.
type _photoBackupSources = Expect<
	ServerProvides<
		Outputs['photos']['backupSources'],
		{
			capabilities: string[]
			sources: Array<{
				id: string
				name: string
				createdAt: number
				lastImportAt?: number
				lastSeenAt?: number
				platform?: string
				stats: {photos: number; videos: number; sizeBytes: number}
			}>
		}
	>
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
