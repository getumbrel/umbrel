import fsp from 'node:fs/promises'
import nodePath from 'node:path'

import {execa} from 'execa'
import fse from 'fs-extra'

import {
	installCommandOptions,
	MACHINE_INSTALL_CLEANUP_TIMEOUT_MS,
	MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS,
} from './install-command.ts'

export type WindowsInstaller = 'windows-11' | 'windows-server-2025' | 'windows-7' | 'windows-xp' | 'windows-98'
export type WindowsArchitecture = 'amd64' | 'arm64'

export type WindowsInstallOptions = {
	installer: WindowsInstaller
	username: string
	password: string
	licenseKey?: string
	completionUrl: string
	arch: WindowsArchitecture
	virtioIso?: string
	patcher9xArchive?: string
	windows98BootImage?: string
	bootFloppyDestination?: string
}

export function windowsVirtioDriverPaths(
	installer: Extract<WindowsInstaller, 'windows-11' | 'windows-server-2025' | 'windows-7'>,
	arch: WindowsArchitecture,
) {
	if (installer === 'windows-7') return []
	if (arch === 'arm64') {
		return [
			['storage', 'viostor/w11/ARM64'],
			['network', 'NetKVM/w11/ARM64'],
			['balloon', 'Balloon/w11/ARM64'],
		] as const
	}
	const version = installer === 'windows-11' ? 'w11' : '2k25'
	return [
		['storage', 'amd64/w11'],
		['network', 'NetKVM/2k25/amd64'],
		['balloon', 'Balloon/2k25/amd64'],
		['display', `viogpudo/${version}/amd64`],
	] as const
}

export function windowsVirtioExtractionPaths(
	installer: Extract<WindowsInstaller, 'windows-11' | 'windows-server-2025' | 'windows-7'>,
	arch: WindowsArchitecture,
) {
	const driverPaths = windowsVirtioDriverPaths(installer, arch).map(([, path]) => path)
	// virtio-win stores convenience Windows 11 trees as hard links to the
	// Server 2025 directory. On ARM64 this applies to every injected driver;
	// on amd64 it currently applies to viogpudo. Extract canonical targets first
	// or a selective bsdtar extraction cannot materialize the link entries. The
	// ARM64 NetKVM Readme is itself linked to the amd64 copy, so include that one
	// cross-architecture target too.
	const driverArch = arch === 'arm64' ? 'ARM64' : 'amd64'
	const canonicalTargets =
		installer === 'windows-11'
			? arch === 'arm64'
				? ['NetKVM/2k25/amd64/Readme.md', ...driverPaths.map((path) => path.replace('/w11/', '/2k25/'))]
				: [`viogpudo/2k25/${driverArch}`]
			: []
	return [...new Set([...canonicalTargets, ...driverPaths])]
}

// virtio-win's bundle of its drivers and the SPICE guest agent that shares the
// clipboard with the console. There's no Arm build of the agent, and Windows 7
// has no virtio devices for it to use.
const WINDOWS_GUEST_TOOLS = 'virtio-win-guest-tools.exe'

function windowsGuestToolsSupported({installer, arch}: Pick<WindowsInstallOptions, 'installer' | 'arch'>) {
	return arch === 'amd64' && (installer === 'windows-11' || installer === 'windows-server-2025')
}

type LegacyElToritoBoot = {
	diskPath: string
	isoPath: string
	emulation: 'no_emulation' | 'diskette' | 'hard_disk'
	loadSize: number
}

function escapeXml(value: string) {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeIni(value: string) {
	return value.replace(/[\r\n]/g, '').replace(/"/g, '""')
}

function requireLegacyLicenseKey(options: WindowsInstallOptions) {
	const key = options.licenseKey?.trim().toUpperCase()
	if (!key || !/^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}$/.test(key)) {
		throw new Error('[machine-windows-license-key-required]')
	}
	return key
}

function windowsCompletionCommand(completionUrl: string, {disableSleep = false} = {}) {
	const powerManagement = disableSleep
		? 'powercfg.exe /change standby-timeout-ac 0; powercfg.exe /change standby-timeout-dc 0; powercfg.exe /hibernate off; '
		: ''
	return `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${powerManagement}$ok=$false; 1..60 | ForEach-Object { if (-not $ok) { try { $request=New-Object -ComObject WinHttp.WinHttpRequest.5.1; $request.SetTimeouts(5000,5000,5000,5000); $request.Open('POST','${completionUrl}',$false); $request.Send(); $ok=$request.Status -ge 200 -and $request.Status -lt 300 } catch {}; if (-not $ok) { Start-Sleep -Seconds 5 } } }; if (-not $ok) { exit 1 }"`
}

export function renderWindowsSetupComplete(options: WindowsInstallOptions) {
	return `@echo off\r\n${windowsCompletionCommand(options.completionUrl)}\r\nexit /b 0\r\n`
}

export function renderWindowsUnattend(options: WindowsInstallOptions) {
	const {installer} = options
	if (installer === 'windows-xp' || installer === 'windows-98') {
		throw new Error('[machine-windows-unattend-format-invalid]')
	}
	const username = escapeXml(options.username)
	const password = escapeXml(options.password)
	const processorArchitecture = options.arch
	const modern = installer === 'windows-11' || installer === 'windows-server-2025'
	const completionCommand = escapeXml(windowsCompletionCommand(options.completionUrl, {disableSleep: modern}))
	const installMetadata =
		installer === 'windows-server-2025'
			? `<MetaData wcm:action="add"><Key>/IMAGE/INDEX</Key><Value>2</Value></MetaData>`
			: installer === 'windows-11'
				? `<MetaData wcm:action="add"><Key>/IMAGE/NAME</Key><Value>Windows 11 Pro</Value></MetaData>`
				: `<MetaData wcm:action="add"><Key>/IMAGE/NAME</Key><Value>Windows 7 ENTERPRISE</Value></MetaData>`
	const productKey =
		installer === 'windows-11'
			? `<ProductKey><Key>VK7JG-NPHTM-C97JM-9MPGT-3V66T</Key><WillShowUI>Never</WillShowUI></ProductKey>`
			: ''
	// The ARM installer is a removable USB disk, so WinPE enumerates it before
	// the virtio target disk. Other installers attach as CD/DVD media instead.
	const installDiskId = options.arch === 'arm64' ? 1 : 0
	const diskConfiguration = modern
		? `<DiskConfiguration><Disk wcm:action="add"><DiskID>${installDiskId}</DiskID><WillWipeDisk>true</WillWipeDisk><CreatePartitions><CreatePartition wcm:action="add"><Order>1</Order><Type>EFI</Type><Size>100</Size></CreatePartition><CreatePartition wcm:action="add"><Order>2</Order><Type>MSR</Type><Size>16</Size></CreatePartition><CreatePartition wcm:action="add"><Order>3</Order><Type>Primary</Type><Extend>true</Extend></CreatePartition></CreatePartitions><ModifyPartitions><ModifyPartition wcm:action="add"><Order>1</Order><PartitionID>1</PartitionID><Format>FAT32</Format><Label>System</Label></ModifyPartition><ModifyPartition wcm:action="add"><Order>2</Order><PartitionID>3</PartitionID><Format>NTFS</Format><Label>Windows</Label><Letter>C</Letter></ModifyPartition></ModifyPartitions></Disk><WillShowUI>OnError</WillShowUI></DiskConfiguration><ImageInstall><OSImage><InstallFrom>${installMetadata}</InstallFrom><InstallTo><DiskID>${installDiskId}</DiskID><PartitionID>3</PartitionID></InstallTo><WillShowUI>OnError</WillShowUI></OSImage></ImageInstall>`
		: `<DiskConfiguration><Disk wcm:action="add"><DiskID>0</DiskID><WillWipeDisk>true</WillWipeDisk><CreatePartitions><CreatePartition wcm:action="add"><Order>1</Order><Type>Primary</Type><Extend>true</Extend></CreatePartition></CreatePartitions><ModifyPartitions><ModifyPartition wcm:action="add"><Order>1</Order><PartitionID>1</PartitionID><Active>true</Active><Format>NTFS</Format><Label>Windows</Label><Letter>C</Letter></ModifyPartition></ModifyPartitions></Disk><WillShowUI>OnError</WillShowUI></DiskConfiguration><ImageInstall><OSImage><InstallFrom>${installMetadata}</InstallFrom><InstallTo><DiskID>0</DiskID><PartitionID>1</PartitionID></InstallTo><WillShowUI>OnError</WillShowUI></OSImage></ImageInstall>`
	const oobe = modern
		? `<HideEULAPage>true</HideEULAPage><HideOnlineAccountScreens>true</HideOnlineAccountScreens><HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE><ProtectYourPC>3</ProtectYourPC>`
		: `<HideEULAPage>true</HideEULAPage><NetworkLocation>Home</NetworkLocation><ProtectYourPC>3</ProtectYourPC>`
	// Windows 7 runs its completion callback from SetupComplete.cmd instead.
	// FirstLogonCommands proved unreliable on a clean Enterprise SP1 install,
	// while SetupComplete is supported for Enterprise and runs as Local System.
	// Guest tools go first so a machine reported as ready already shares its
	// clipboard. Windows moves on to the next command if the install fails.
	const guestToolsCommand = windowsGuestToolsSupported(options)
		? `<SynchronousCommand wcm:action="add"><Order>1</Order><Description>Install guest tools</Description><CommandLine>C:\\Windows\\Setup\\Umbrel\\${WINDOWS_GUEST_TOOLS} /install /quiet /norestart</CommandLine></SynchronousCommand>`
		: ''
	const firstLogonCommands =
		installer === 'windows-7'
			? ''
			: `<FirstLogonCommands>${guestToolsCommand}<SynchronousCommand wcm:action="add"><Order>${guestToolsCommand ? 2 : 1}</Order><Description>Complete Umbrel machine setup</Description><CommandLine>${completionCommand}</CommandLine></SynchronousCommand></FirstLogonCommands>`

	return `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE" processorArchitecture="${processorArchitecture}" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><SetupUILanguage><UILanguage>en-US</UILanguage></SetupUILanguage><InputLocale>en-US</InputLocale><SystemLocale>en-US</SystemLocale><UILanguage>en-US</UILanguage><UserLocale>en-US</UserLocale></component>
    <component name="Microsoft-Windows-Setup" processorArchitecture="${processorArchitecture}" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">${diskConfiguration}<UserData><AcceptEula>true</AcceptEula>${productKey}</UserData></component>
  </settings>
  <settings pass="specialize"><component name="Microsoft-Windows-Shell-Setup" processorArchitecture="${processorArchitecture}" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><ComputerName>*</ComputerName><TimeZone>UTC</TimeZone></component></settings>
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-International-Core" processorArchitecture="${processorArchitecture}" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><InputLocale>en-US</InputLocale><SystemLocale>en-US</SystemLocale><UILanguage>en-US</UILanguage><UserLocale>en-US</UserLocale></component>
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="${processorArchitecture}" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><OOBE>${oobe}</OOBE><UserAccounts><AdministratorPassword><Value>${password}</Value><PlainText>true</PlainText></AdministratorPassword><LocalAccounts><LocalAccount wcm:action="add"><Name>${username}</Name><DisplayName>${username}</DisplayName><Group>Administrators</Group><Password><Value>${password}</Value><PlainText>true</PlainText></Password></LocalAccount></LocalAccounts></UserAccounts><AutoLogon><Enabled>true</Enabled><LogonCount>1</LogonCount><Username>${username}</Username><Password><Value>${password}</Value><PlainText>true</PlainText></Password></AutoLogon>${firstLogonCommands}</component>
  </settings>
</unattend>
`
}

export function renderWindowsXpSif(options: WindowsInstallOptions) {
	const licenseKey = requireLegacyLicenseKey(options)
	return `[Data]
AutoPartition=1
MsDosInitiated=0
UnattendedInstall=Yes

[Unattended]
UnattendMode=FullUnattended
OemSkipEula=Yes
OemPreinstall=Yes
Repartition=Yes
TargetPath=\\WINDOWS
FileSystem=NTFS
WaitForReboot=No

[GuiUnattended]
AdminPassword="${escapeIni(options.password)}"
EncryptedAdminPassword=No
AutoLogon=Yes
AutoLogonCount=1
OEMSkipRegional=1
TimeZone=85
OemSkipWelcome=1

[UserData]
ProductKey=${licenseKey}
FullName="${escapeIni(options.username)}"
OrgName="Umbrel"
ComputerName=*

[Identification]
JoinWorkgroup=WORKGROUP

[Networking]
InstallDefaultComponents=Yes

[Display]
BitsPerPel=32
Xresolution=800
YResolution=600
Vrefresh=60
AutoConfirm=1

[GuiRunOnce]
Command0="cmd.exe /d /c for %d in (D E F G H I J K L M N O P Q R S T U V W X Y Z) do @if exist %d:\\I386\\UMBREL.VBS cscript.exe //nologo %d:\\I386\\UMBREL.VBS"
`
}

export function renderWindows98Batch(options: WindowsInstallOptions) {
	const licenseKey = requireLegacyLicenseKey(options)
	// Windows 98 does not reliably enumerate QEMU's PCI NICs on modern i440fx.
	// Install its in-box NE2000 driver with the same fixed ISA resources exposed
	// by the domain so networking is ready without PCI Plug and Play discovery.
	const batch = `[BatchSetup]
Version=3.0 (32-bit)
SaveDate=01/01/99

[Version]
Signature="$CHICAGO$"

[Setup]
Express=1
InstallDir="C:\\WINDOWS"
InstallType=1
ProductKey="${licenseKey}"
EBD=0
ShowEula=0
ChangeDir=0
OptionalComponents=0
Network=1
System=0
CCP=0
CleanBoot=0
Display=0
DevicePath=0
NoDirWarn=1
TimeZone="Pacific"
Uninstall=0
VRC=0
NoPrompt2Boot=1

[System]
Locale=L0409
SelectedKeyboard=KEYBOARD_00000409

[NameAndOrg]
Name="${escapeIni(options.username)}"
Org="Umbrel"
Display=0

[Network]
ComputerName="UMBRELVM"
Workgroup="WORKGROUP"
Description="Umbrel Machine"
Display=0
PrimaryLogon=VREDIR
Clients=VREDIR
NetCards=*pnp80d6
Protocols=MSTCP
Services=VSERVER
Security=SHARE

[*pnp80d6]
Interrupt=3
IOBase=0x200
InterruptNumber=3
IOBaseAddress=0x200

[MSTCP]
LMHOSTS=1
LMHOSTPath="C:\\WINDOWS\\LMHOSTS"
DHCP=1
DNS=0
WINS=N
Hostname=UMBRELVM

[VREDIR]
LogonDomain="WORKGROUP"
ValidatedLogon=0

[VSERVER]
LMAnnounce=0
MaintainServerList=2

[Printers]

[InstallLocationsMRU]
"C:\\WINDOWS\\OPTIONS\\CABS"

[Install]
AddReg=Umbrel.Completion

[Umbrel.Completion]
HKLM,"Software\\Microsoft\\Windows\\CurrentVersion\\Run","UmbrelSetupComplete",0,"mshta.exe D:\\WIN98\\UMBREL.HTA"
`
	return batch.replace(/\n/g, '\r\n')
}

export function renderWindows98CompletionHta(options: WindowsInstallOptions) {
	const completionUrl = options.completionUrl.replace(/[\r\n']/g, '')
	return `<html>
<head>
<hta:application border="none" caption="no" showintaskbar="no" windowstate="minimize" />
<script language="javascript">
var attempts=0,completed=false;
function closeWindow(){window.close();}
function done(){if(completed)return;completed=true;try{new ActiveXObject('WScript.Shell').RegDelete('HKLM\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run\\\\UmbrelSetupComplete');}catch(e){}setTimeout(closeWindow,1000);}
function retry(){if(completed)return;if(attempts++<60){setTimeout(send,5000);}else{setTimeout(closeWindow,1000);}}
function send(){try{var request=new ActiveXObject('Microsoft.XMLHTTP');request.open('POST','${completionUrl}',true);request.onreadystatechange=function(){if(request.readyState==4){if(request.status>=200&&request.status<300){done();}else{retry();}}};request.send();}catch(e){retry();}}
send();
</script>
</head>
<body></body>
</html>
`.replace(/\n/g, '\r\n')
}

export function renderWindows98BootConfig() {
	return `device=himem.sys /testmem:off
devicehigh=oakcdrom.sys /D:oemcd001
files=60
buffers=20
dos=high,umb
stacks=9,256
lastdrive=z
`.replace(/\n/g, '\r\n')
}

export function renderWindows98BootAutoexec() {
	return `@ECHO OFF
SET DIRCMD=/O:N
PATH=A:\\
IF EXIST C:\\WINDOWS\\WIN.COM GOTO WINDOWS
LH MSCDEX.EXE /D:oemcd001 /L:D
FDISK /MBR
D:\\WIN98\\SETUP.EXE D:\\WIN98\\MSBATCH.INF /IE /NF /IS /IW
GOTO END
:WINDOWS
SYS C:
DEBUG < DISABLE.SCR
:END
`.replace(/\n/g, '\r\n')
}

export function renderWindows98DisableFloppyScript() {
	// Replace the private floppy's first instruction with INT 18h, then ask the
	// BIOS to bootstrap again without returning to DOS. SeaBIOS immediately
	// advances to the hard disk, whose boot code was installed by SYS C:.
	return `L 100 0 0 1
E 100 CD 18
W 100 0 0 1
E 300 CD 19
G=300
`.replace(/\n/g, '\r\n')
}

async function prepareWindows98BootFloppy(options: WindowsInstallOptions, overlay: string, signal: AbortSignal) {
	if (!options.windows98BootImage || !options.bootFloppyDestination) {
		throw new Error('[machine-windows-98-boot-image-unavailable]')
	}
	await fse.copy(options.windows98BootImage, options.bootFloppyDestination)
	if (signal.aborted) throw signal.reason
	const config = nodePath.join(overlay, 'CONFIG.SYS')
	const autoexec = nodePath.join(overlay, 'AUTOEXEC.BAT')
	const disable = nodePath.join(overlay, 'DISABLE.SCR')
	await Promise.all([
		fsp.writeFile(config, renderWindows98BootConfig(), {mode: 0o600}),
		fsp.writeFile(autoexec, renderWindows98BootAutoexec(), {mode: 0o600}),
		fsp.writeFile(disable, renderWindows98DisableFloppyScript(), {mode: 0o600}),
	])
	const commandOptions = installCommandOptions(signal, MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS)
	await execa('mcopy', ['-o', '-i', options.bootFloppyDestination, config, '::CONFIG.SYS'], commandOptions)
	await execa('mcopy', ['-o', '-i', options.bootFloppyDestination, autoexec, '::AUTOEXEC.BAT'], commandOptions)
	await execa('mcopy', ['-o', '-i', options.bootFloppyDestination, disable, '::DISABLE.SCR'], commandOptions)
}

function renderXpCompletionVbs(options: WindowsInstallOptions) {
	const value = (input: string) => input.replace(/[\r\n]/g, '').replace(/"/g, '""')
	return `On Error Resume Next
Set computer = GetObject("WinNT://.")
Set user = computer.Create("user", "${value(options.username)}")
user.SetPassword "${value(options.password)}"
user.SetInfo
Set administrators = GetObject("WinNT://./Administrators,group")
administrators.Add user.ADsPath
Set request = CreateObject("WinHttp.WinHttpRequest.5.1")
request.Open "POST", "${value(options.completionUrl)}", False
request.Send
`
}

async function assertSafeIso(source: string, signal: AbortSignal) {
	const {stdout} = await execa('bsdtar', ['-tf', source], {
		...installCommandOptions(signal),
		maxBuffer: 100 * 1024 * 1024,
	})
	const entries = stdout.split('\n').filter(Boolean)
	for (const entry of entries) {
		if (entry.startsWith('/') || entry.split('/').includes('..')) throw new Error('[machine-windows-iso-unsafe-path]')
	}
	return entries
}

async function uppercaseDirectoryTree(directory: string, signal: AbortSignal): Promise<void> {
	if (signal.aborted) throw signal.reason
	const entries = await fsp.readdir(directory, {withFileTypes: true})
	for (const entry of entries) {
		if (signal.aborted) throw signal.reason
		const source = nodePath.join(directory, entry.name)
		if (entry.isDirectory()) await uppercaseDirectoryTree(source, signal)
		const uppercaseName = entry.name.toUpperCase()
		if (uppercaseName === entry.name) continue
		const destination = nodePath.join(directory, uppercaseName)
		if (await fse.pathExists(destination)) throw new Error('[machine-windows-source-invalid]')
		await fsp.rename(source, destination)
	}
}

export function buildXorrisoEditArgs(
	source: string,
	destination: string,
	removePath: string | undefined,
	mappings: Array<[string, string]>,
	legacyBoot?: Omit<LegacyElToritoBoot, 'diskPath'>,
) {
	const args = ['-return_with', 'FAILURE', '32']
	// xorriso exposes bare ISO9660 names as lowercase by default when loading
	// media without Rock Ridge or Joliet. Legacy DOS installers access the
	// repacked tree through MSCDEX, which requires the original uppercase ECMA-119
	// identifiers. Normalize the imported tree before applying our overlay.
	if (legacyBoot) {
		args.push('-ecma119_map', 'uppercase', '-compliance', 'full_ascii:omit_version:no_force_dots')
	}
	args.push('-indev', source)
	if (legacyBoot) args.push('-rockridge', 'off')
	args.push('-outdev', destination, '-boot_image', 'any')
	args.push(legacyBoot ? 'discard' : 'replay')
	// xorriso's -rm accepts a variable-length path list. Terminate it explicitly
	// or every following -map is consumed as another path to remove.
	if (removePath) args.push('-rm_r', `/${removePath}`, '--')
	for (const [from, to] of mappings) args.push('-map', from, to)
	if (legacyBoot) {
		args.push(
			'-find',
			legacyBoot.isoPath,
			'-exec',
			'sort_weight',
			'100000',
			'--',
			'-boot_image',
			'any',
			`bin_path=${legacyBoot.isoPath}`,
			'-boot_image',
			'any',
			'cat_path=/.umbrel-boot/boot.cat',
			'-boot_image',
			'any',
			`emul_type=${legacyBoot.emulation}`,
			'-boot_image',
			'any',
			`load_size=${legacyBoot.loadSize}`,
			'-boot_image',
			'any',
			'cat_hidden=on',
		)
	}
	return args
}

export function buildGenisoimageArgs(
	sourceDirectory: string,
	destination: string,
	installer: Extract<WindowsInstaller, 'windows-11' | 'windows-server-2025' | 'windows-7'>,
	mappings: Array<[string, string]>,
) {
	const args = [
		'-udf',
		'-iso-level',
		'3',
		'-allow-limited-size',
		'-J',
		'-joliet-long',
		'-V',
		'UMBREL_WINDOWS',
		'-b',
		'boot/etfsboot.com',
		'-no-emul-boot',
		'-boot-load-size',
		'8',
	]
	if (installer !== 'windows-7') {
		args.push('-eltorito-alt-boot', '-e', 'efi/microsoft/boot/efisys_noprompt.bin', '-no-emul-boot')
	}
	args.push('-o', destination, '-graft-points', `/=${sourceDirectory}`)
	for (const [from, to] of mappings) args.push(`${to.replace(/^\//, '')}=${from}`)
	return args
}

export function parseLegacyElToritoReport(report: string) {
	const images = [...report.matchAll(/^El Torito boot img\s*:\s*\d+\s+BIOS\s+y\s+(\S+)\s+\S+\s+\S+\s+(\d+)\s+\d+$/gm)]
	if (images.length !== 1) throw new Error('[machine-windows-legacy-boot-image-invalid]')
	const [, emulation, loadSectors] = images[0]
	const mappedEmulation = emulation === 'none' ? 'no_emulation' : emulation === 'hd' ? 'hard_disk' : 'diskette'
	const floppyImageSize =
		emulation === 'fd1.2'
			? 1_228_800
			: emulation === 'fd1.4'
				? 1_474_560
				: emulation === 'fd2.8'
					? 2_949_120
					: undefined
	return {
		emulation: mappedEmulation as LegacyElToritoBoot['emulation'],
		loadSize: Number(loadSectors) * 512,
		floppyImageSize,
	}
}

const MEBIBYTE = 1024 * 1024
const GIBIBYTE = 1024 * MEBIBYTE
const FAT32_MAX_FILE_BYTES = 0xffff_ffff

export function windowsArmUsbImageSize(sourceSize: number) {
	// Leave room for the unattended answer file, virtio drivers, FAT metadata,
	// and small changes between Microsoft point releases.
	return Math.ceil((sourceSize + 512 * MEBIBYTE) / GIBIBYTE) * GIBIBYTE
}

async function copyToFatImage(image: string, entries: string[], destination: string, signal: AbortSignal) {
	if (entries.length === 0) return
	await execa('mcopy', ['-s', '-o', '-i', image, ...entries, destination], installCommandOptions(signal))
}

async function prepareWindowsArmUsbMedia({
	source,
	sourceMount,
	destination,
	mappings,
	overlay,
	signal,
}: {
	source: string
	sourceMount: string
	destination: string
	mappings: Array<[string, string]>
	overlay: string
	signal: AbortSignal
}) {
	if (signal.aborted) throw signal.reason
	const imageSize = windowsArmUsbImageSize((await fsp.stat(source)).size)
	await fsp.writeFile(destination, '')
	await fsp.truncate(destination, imageSize)
	await execa('mkfs.fat', ['-F', '32', '-n', 'UMBREL_WIN', destination], installCommandOptions(signal))

	const rootEntries = (await fsp.readdir(sourceMount))
		.filter((entry) => entry.toLowerCase() !== 'sources')
		.map((entry) => nodePath.join(sourceMount, entry))
	await copyToFatImage(destination, rootEntries, '::', signal)
	await execa(
		'mmd',
		['-i', destination, '::sources'],
		installCommandOptions(signal, MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS),
	)

	const sourcesDirectory = nodePath.join(sourceMount, 'sources')
	const installWim = nodePath.join(sourcesDirectory, 'install.wim')
	if (!(await fse.pathExists(installWim))) throw new Error('[machine-windows-source-invalid]')
	const splitInstallWim = (await fsp.stat(installWim)).size > FAT32_MAX_FILE_BYTES
	const sourceEntries = (await fsp.readdir(sourcesDirectory))
		.filter((entry) => !splitInstallWim || entry.toLowerCase() !== 'install.wim')
		.map((entry) => nodePath.join(sourcesDirectory, entry))
	await copyToFatImage(destination, sourceEntries, '::sources/', signal)

	if (splitInstallWim) {
		const splitDirectory = nodePath.join(overlay, 'split-wim')
		await fse.ensureDir(splitDirectory)
		await execa('wimlib-imagex', ['split', installWim, nodePath.join(splitDirectory, 'install.swm'), '3800'], {
			...installCommandOptions(signal),
			stdout: 'ignore',
		})
		const parts = (await fsp.readdir(splitDirectory))
			.filter((entry) => entry.toLowerCase().endsWith('.swm'))
			.map((entry) => nodePath.join(splitDirectory, entry))
		await copyToFatImage(destination, parts, '::sources/', signal)
	}

	const fatOverlay = nodePath.join(overlay, 'fat-overlay')
	for (const [from, to] of mappings) {
		if (signal.aborted) throw signal.reason
		const target = nodePath.join(fatOverlay, to.replace(/^\/+/, ''))
		await fse.ensureDir(nodePath.dirname(target))
		await fse.copy(from, target, {overwrite: true})
	}
	const overlayEntries = (await fsp.readdir(fatOverlay)).map((entry) => nodePath.join(fatOverlay, entry))
	await copyToFatImage(destination, overlayEntries, '::', signal)
}

async function extractLegacyElToritoBoot(
	source: string,
	overlay: string,
	signal: AbortSignal,
): Promise<LegacyElToritoBoot> {
	const {stdout} = await execa(
		'xorriso',
		['-indev', source, '-report_el_torito', 'plain'],
		installCommandOptions(signal, MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS),
	)
	const boot = parseLegacyElToritoReport(stdout)
	const directory = nodePath.join(overlay, 'eltorito')
	await fse.ensureDir(directory)
	await execa(
		'xorriso',
		['-osirrox', 'on', '-indev', source, '-extract_boot_images', directory],
		installCommandOptions(signal),
	)
	const diskPath = nodePath.join(directory, 'eltorito_img1_bios.img')
	if (!(await fse.pathExists(diskPath))) throw new Error('[machine-windows-legacy-boot-image-invalid]')
	// For hidden floppy-emulation images xorriso cannot infer the boundary and
	// may copy adjacent ISO sectors. The catalog's emulation type defines the
	// exact disk geometry, so trim to that canonical size before reattaching it.
	if (boot.floppyImageSize) await fsp.truncate(diskPath, boot.floppyImageSize)
	return {emulation: boot.emulation, loadSize: boot.loadSize, diskPath, isoPath: '/.umbrel-boot/boot.img'}
}

export async function prepareWindowsInstallMedia(
	source: string,
	destination: string,
	options: WindowsInstallOptions,
	signal: AbortSignal,
) {
	const entries = await assertSafeIso(source, signal)
	const overlay = `${destination}.${process.pid}.${Date.now()}.overlay`
	const sourceMount = nodePath.join(overlay, 'source')
	await fse.ensureDir(overlay)
	try {
		const mappings: Array<[string, string]> = []
		let replacedIsoPath: string | undefined
		const legacyBoot =
			options.installer === 'windows-xp' || options.installer === 'windows-98'
				? await extractLegacyElToritoBoot(source, overlay, signal)
				: undefined
		if (legacyBoot) mappings.push([legacyBoot.diskPath, legacyBoot.isoPath])
		if (options.installer === 'windows-xp') {
			const i386 = entries.find((entry) => /^i386\//i.test(entry))?.split('/')[0] ?? 'I386'
			const sif = nodePath.join(overlay, 'WINNT.SIF')
			const script = nodePath.join(overlay, 'complete.vbs')
			await fsp.writeFile(sif, renderWindowsXpSif(options), {mode: 0o600})
			await fsp.writeFile(script, renderXpCompletionVbs(options), {mode: 0o600})
			// Run the private script straight from the install CD. Some retail XP
			// media ignores $OEM$ file copying during CD-based unattended setup;
			// scanning optical drive letters avoids relying on that brittle step.
			mappings.push([sif, `/${i386}/WINNT.SIF`], [script, `/${i386}/UMBREL.VBS`])
		} else if (options.installer === 'windows-98') {
			if (!options.patcher9xArchive) throw new Error('[machine-windows-98-patcher-unavailable]')
			const win98 = entries.find((entry) => /^win98\//i.test(entry))?.split('/')[0]
			if (!win98) throw new Error('[machine-windows-98-source-invalid]')
			await execa('bsdtar', ['-xf', source, '-C', overlay, win98], installCommandOptions(signal))
			const patcherDirectory = nodePath.join(overlay, 'patcher9x')
			await fse.ensureDir(patcherDirectory)
			await execa('bsdtar', ['-xf', options.patcher9xArchive, '-C', patcherDirectory], installCommandOptions(signal))
			const patcher = nodePath.join(patcherDirectory, 'patcher9x')
			await fsp.chmod(patcher, 0o700)
			await execa(patcher, ['-auto', '-no-backup', nodePath.join(overlay, win98)], installCommandOptions(signal))
			const batch = nodePath.join(overlay, win98, 'MSBATCH.INF')
			const completion = nodePath.join(overlay, win98, 'UMBREL.HTA')
			await Promise.all([
				fsp.writeFile(batch, renderWindows98Batch(options), {mode: 0o600}),
				fsp.writeFile(completion, renderWindows98CompletionHta(options), {mode: 0o600}),
			])
			// MSCDEX resolves the ISO's ECMA-119 tree literally on this boot disk.
			// Keep the patched replacement tree in the source media's uppercase
			// DOS form so it replaces /WIN98 instead of creating a second /win98.
			await uppercaseDirectoryTree(nodePath.join(overlay, win98), signal)
			await prepareWindows98BootFloppy(options, overlay, signal)
			replacedIsoPath = win98
			mappings.push([nodePath.join(overlay, win98), `/${win98.toUpperCase()}`])
		} else {
			const answer = nodePath.join(overlay, 'autounattend.xml')
			await fsp.writeFile(answer, renderWindowsUnattend(options), {mode: 0o600})
			mappings.push([answer, '/autounattend.xml'])
			if (options.installer === 'windows-7') {
				const setupComplete = nodePath.join(overlay, 'SetupComplete.cmd')
				await fsp.writeFile(setupComplete, renderWindowsSetupComplete(options), {mode: 0o600})
				mappings.push([setupComplete, '/sources/$OEM$/$$/Setup/Scripts/SetupComplete.cmd'])
			}
			if (options.virtioIso) {
				const drivers = nodePath.join(overlay, 'drivers')
				const extracted = nodePath.join(overlay, 'virtio-extracted')
				await Promise.all([fse.ensureDir(drivers), fse.ensureDir(extracted)])
				// The convenience w11 trees in virtio-win contain hard links. Extract
				// their canonical targets first so libarchive has real file payloads,
				// then stage compact, edition-agnostic folders for Windows PE discovery.
				for (const path of windowsVirtioExtractionPaths(options.installer, options.arch)) {
					await execa('bsdtar', ['-xf', options.virtioIso, '-C', extracted, path], installCommandOptions(signal))
				}
				for (const [name, path] of windowsVirtioDriverPaths(options.installer, options.arch)) {
					if (signal.aborted) throw signal.reason
					await fse.copy(nodePath.join(extracted, path), nodePath.join(drivers, name))
				}
				mappings.push([drivers, '/$WinPEDriver$'])
				if (windowsGuestToolsSupported(options)) {
					await execa(
						'bsdtar',
						['-xf', options.virtioIso, '-C', extracted, WINDOWS_GUEST_TOOLS],
						installCommandOptions(signal),
					)
					// Setup copies $OEM$/$$ into C:\Windows, so first logon finds the
					// installer whatever drive letter the install media ends up on
					mappings.push([
						nodePath.join(extracted, WINDOWS_GUEST_TOOLS),
						`/sources/$OEM$/$$/Setup/Umbrel/${WINDOWS_GUEST_TOOLS}`,
					])
				}
			}
		}

		// Legacy media needs its reconstructed boot image and imported ISO9660
		// tree. Modern Microsoft media stores the installer in UDF, so rebuild it
		// from a read-only mount and select its no-prompt UEFI boot image directly.
		if (legacyBoot) {
			await execa(
				'xorriso',
				buildXorrisoEditArgs(source, destination, replacedIsoPath, mappings, legacyBoot),
				installCommandOptions(signal),
			)
		} else {
			await fse.ensureDir(sourceMount)
			await execa(
				'mount',
				['-o', 'loop,ro,nosuid,nodev,noexec', source, sourceMount],
				installCommandOptions(signal, MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS),
			)
			const installer = options.installer as Extract<
				WindowsInstaller,
				'windows-11' | 'windows-server-2025' | 'windows-7'
			>
			for (const required of [
				'boot/etfsboot.com',
				...(installer === 'windows-7' ? [] : ['efi/microsoft/boot/efisys_noprompt.bin']),
				...(options.arch === 'arm64' ? ['efi/boot/bootaa64.efi', 'sources/install.wim'] : []),
			]) {
				if (signal.aborted) throw signal.reason
				if (!(await fse.pathExists(nodePath.join(sourceMount, required)))) {
					throw new Error('[machine-windows-source-invalid]')
				}
			}
			if (options.arch === 'arm64') {
				await prepareWindowsArmUsbMedia({source, sourceMount, destination, mappings, overlay, signal})
			} else {
				await execa(
					'genisoimage',
					buildGenisoimageArgs(sourceMount, destination, installer, mappings),
					installCommandOptions(signal),
				)
			}
		}
	} catch (error) {
		await fse.remove(destination)
		throw error
	} finally {
		// Always attempt this: cancellation can race a successful mount before its
		// child promise settles, so a local boolean is not sufficient authority.
		await execa('umount', ['--lazy', sourceMount], {
			reject: false,
			timeout: MACHINE_INSTALL_CLEANUP_TIMEOUT_MS,
		})
		// Installer media can mark extracted directories read-only. Restore owner
		// write access so cleanup cannot fail or mask the original preparation error.
		await execa('chmod', ['-R', 'u+rwX', overlay], {
			reject: false,
			timeout: MACHINE_INSTALL_CLEANUP_TIMEOUT_MS,
		})
		await fse.remove(overlay)
	}
}
