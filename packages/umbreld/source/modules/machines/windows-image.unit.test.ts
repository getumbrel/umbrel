import {describe, expect, test} from 'vitest'

import {
	buildGenisoimageArgs,
	buildXorrisoEditArgs,
	parseLegacyElToritoReport,
	renderWindows98Batch,
	renderWindows98BootAutoexec,
	renderWindows98BootConfig,
	renderWindows98CompletionHta,
	renderWindows98DisableFloppyScript,
	renderWindowsSetupComplete,
	renderWindowsUnattend,
	renderWindowsXpSif,
	windowsArmUsbImageSize,
	windowsVirtioDriverPaths,
	windowsVirtioExtractionPaths,
} from './windows-image.ts'

const common = {
	arch: 'amd64',
	username: 'Luke & Co',
	password: 'secret<&"',
	completionUrl: 'http://192.168.1.2/api/machines/first-boot/id/a&b',
} as const
const fakeLegacyLicenseKey = 'TEST1-TEST2-TEST3-TEST4-TEST5'

describe('Windows unattended installers', () => {
	test('configures Windows 11 with GPT, a local administrator, and the completion callback', () => {
		const answer = renderWindowsUnattend({...common, installer: 'windows-11'})
		expect(answer).toContain('<Type>EFI</Type>')
		expect(answer).toContain('<Value>Windows 11 Pro</Value>')
		expect(answer).toContain('<Name>Luke &amp; Co</Name>')
		expect(answer).toContain('<Value>secret&lt;&amp;&quot;</Value>')
		expect(answer).toContain('WinHttp.WinHttpRequest.5.1')
		expect(answer).toContain("Open('POST'")
		expect(answer).toContain('a&amp;b')
		expect(answer).toContain('1..60 | ForEach-Object')
		expect(answer).toContain('Start-Sleep -Seconds 5')
		expect(answer).toContain('SetTimeouts(5000,5000,5000,5000)')
		expect(answer).toContain('-lt 300')
		expect(answer).toContain('powercfg.exe /change standby-timeout-ac 0')
		expect(answer).toContain('powercfg.exe /change standby-timeout-dc 0')
		expect(answer).toContain('powercfg.exe /hibernate off')
	})

	test('installs guest tools before reporting setup complete on x64', () => {
		const command = 'C:\\Windows\\Setup\\Umbrel\\virtio-win-guest-tools.exe /install /quiet /norestart'
		for (const installer of ['windows-11', 'windows-server-2025'] as const) {
			const answer = renderWindowsUnattend({...common, installer})
			expect(answer).toContain(`<Order>1</Order><Description>Install guest tools</Description><CommandLine>${command}`)
			expect(answer).toContain('<Order>2</Order><Description>Complete Umbrel machine setup</Description>')
		}
	})

	test('skips guest tools where no clipboard agent can run', () => {
		const arm = renderWindowsUnattend({...common, installer: 'windows-11', arch: 'arm64'})
		expect(arm).not.toContain('virtio-win-guest-tools')
		expect(arm).toContain('<Order>1</Order><Description>Complete Umbrel machine setup</Description>')
		expect(renderWindowsUnattend({...common, installer: 'windows-7'})).not.toContain('virtio-win-guest-tools')
	})

	test('selects the Desktop Experience image from Windows Server evaluation media', () => {
		const answer = renderWindowsUnattend({...common, installer: 'windows-server-2025'})
		expect(answer).toContain('<Key>/IMAGE/INDEX</Key><Value>2</Value>')
	})

	test('uses an MBR partition and Enterprise image for Windows 7', () => {
		const answer = renderWindowsUnattend({...common, installer: 'windows-7'})
		expect(answer).toContain('<Active>true</Active>')
		expect(answer).toContain('<Value>Windows 7 ENTERPRISE</Value>')
		expect(answer).not.toContain('<Type>EFI</Type>')
		expect(answer).not.toContain('<FirstLogonCommands>')
		const setupComplete = renderWindowsSetupComplete({...common, installer: 'windows-7'})
		expect(setupComplete).toContain('WinHttp.WinHttpRequest.5.1')
		expect(setupComplete).toContain(common.completionUrl)
		expect(setupComplete).toContain('exit /b 0')
		expect(setupComplete).not.toContain('powercfg.exe')
		expect(setupComplete).not.toMatch(/(?<!\r)\n/)
	})

	test('injects the matching virtio display driver only for modern Windows', () => {
		expect(windowsVirtioDriverPaths('windows-11', 'amd64')).toContainEqual(['display', 'viogpudo/w11/amd64'])
		expect(windowsVirtioDriverPaths('windows-server-2025', 'amd64')).toContainEqual(['display', 'viogpudo/2k25/amd64'])
		expect(windowsVirtioDriverPaths('windows-7', 'amd64')).toEqual([])
	})

	test('renders ARM64 answer components and injects the stable Windows 11 Arm virtio drivers', () => {
		const answer = renderWindowsUnattend({...common, installer: 'windows-11', arch: 'arm64'})
		expect(answer).toContain('processorArchitecture="arm64"')
		expect(answer).not.toContain('processorArchitecture="amd64"')
		expect(answer.match(/<DiskID>1<\/DiskID>/g)).toHaveLength(2)
		expect(windowsVirtioDriverPaths('windows-11', 'arm64')).toEqual([
			['storage', 'viostor/w11/ARM64'],
			['network', 'NetKVM/w11/ARM64'],
			['balloon', 'Balloon/w11/ARM64'],
		])
	})

	test('rounds Windows Arm USB media up with FAT and overlay headroom', () => {
		expect(windowsArmUsbImageSize(7_299_147_776)).toBe(8 * 1024 ** 3)
	})

	test('extracts canonical virtio targets before the Windows 11 hard links', () => {
		const paths = windowsVirtioExtractionPaths('windows-11', 'amd64')
		expect(paths).toContain('viogpudo/w11/amd64')
		expect(paths.indexOf('viogpudo/2k25/amd64')).toBeLessThan(paths.indexOf('viogpudo/w11/amd64'))
		expect(windowsVirtioExtractionPaths('windows-server-2025', 'amd64')).toContain('viogpudo/2k25/amd64')
		const armPaths = windowsVirtioExtractionPaths('windows-11', 'arm64')
		expect(armPaths[0]).toBe('NetKVM/2k25/amd64/Readme.md')
		for (const driver of ['viostor', 'NetKVM', 'Balloon']) {
			expect(armPaths.indexOf(`${driver}/2k25/ARM64`)).toBeLessThan(armPaths.indexOf(`${driver}/w11/ARM64`))
		}
		expect(armPaths).not.toContain('viogpudo/w11/ARM64')
	})

	test('renders XP text-mode setup and one-shot completion script invocation', () => {
		const answer = renderWindowsXpSif({...common, installer: 'windows-xp', licenseKey: fakeLegacyLicenseKey})
		expect(answer).toContain('UnattendMode=FullUnattended')
		expect(answer).toContain(`ProductKey=${fakeLegacyLicenseKey}`)
		expect(answer).toContain('[Display]\nBitsPerPel=32\nXresolution=800\nYResolution=600\nVrefresh=60\nAutoConfirm=1')
		expect(answer).toContain('for %d in (D E F G H I J K L M N O P Q R S T U V W X Y Z)')
		expect(answer).toContain('%d:\\I386\\UMBREL.VBS cscript.exe //nologo %d:\\I386\\UMBREL.VBS')
	})

	test('caps Windows 98 setup to a deterministic batch configuration', () => {
		const answer = renderWindows98Batch({...common, installer: 'windows-98', licenseKey: fakeLegacyLicenseKey})
		expect(answer).toContain('Express=1')
		expect(answer).toContain('InstallDir="C:\\WINDOWS"')
		expect(answer).toContain('Signature="$CHICAGO$"')
		expect(answer).toContain('InstallType=1')
		expect(answer).toContain('OptionalComponents=0')
		expect(answer).toContain('ShowEula=0')
		expect(answer).toContain('NoPrompt2Boot=1')
		expect(answer).toContain('TimeZone="Pacific"')
		expect(answer).toContain('NetCards=*pnp80d6')
		expect(answer).toContain('[*pnp80d6]\r\nInterrupt=3\r\nIOBase=0x200\r\nInterruptNumber=3\r\nIOBaseAddress=0x200')
		expect(answer).toContain('Protocols=MSTCP')
		expect(answer).toContain('DHCP=1')
		expect(answer).toContain('Services=VSERVER')
		expect(answer).toContain('[VSERVER]')
		expect(answer).toContain(`ProductKey="${fakeLegacyLicenseKey}"`)
		expect(answer).toContain('CurrentVersion\\Run","UmbrelSetupComplete"')
		expect(answer).toContain('mshta.exe D:\\WIN98\\UMBREL.HTA')
		expect(answer).not.toContain('javascript:')
		expect(answer).not.toMatch(/(?<!\r)\n/)

		const completion = renderWindows98CompletionHta({
			...common,
			installer: 'windows-98',
			licenseKey: fakeLegacyLicenseKey,
		})
		expect(completion).toContain("request.open('POST','http://192.168.1.2/api/machines/first-boot/id/a&b',true)")
		expect(completion).toContain('setTimeout(send,5000)')
		expect(completion).toContain('setTimeout(closeWindow,1000)')
		expect(completion).toContain("RegDelete('HKLM\\\\Software")
		expect(completion).not.toMatch(/(?<!\r)\n/)
	})

	test('requires XP and Windows 98 keys instead of falling back to source-defined defaults', () => {
		expect(() => renderWindowsXpSif({...common, installer: 'windows-xp'})).toThrow(
			'[machine-windows-license-key-required]',
		)
		expect(() => renderWindows98Batch({...common, installer: 'windows-98'})).toThrow(
			'[machine-windows-license-key-required]',
		)
	})

	test('boots Windows 98 setup without waiting for USB media', () => {
		const config = renderWindows98BootConfig()
		const autoexec = renderWindows98BootAutoexec()
		expect(config).toContain('oakcdrom.sys /D:oemcd001')
		expect(config).not.toContain('usbaspi.sys')
		expect(autoexec).toContain('D:\\WIN98\\SETUP.EXE D:\\WIN98\\MSBATCH.INF /IE /NF /IS /IW')
		expect(autoexec).not.toContain('D:\\SETUP.EXE')
		expect(autoexec).toContain('FDISK /MBR')
		expect(autoexec).not.toContain('CD \\WIN98')
		expect(autoexec).toContain('IF EXIST C:\\WINDOWS\\WIN.COM GOTO WINDOWS')
		expect(autoexec).toContain('SYS C:')
		expect(autoexec).toContain('DEBUG < DISABLE.SCR')
		expect(renderWindows98DisableFloppyScript()).toContain('E 100 CD 18')
		expect(renderWindows98DisableFloppyScript()).toContain('E 300 CD 19')
		expect(config).not.toMatch(/(?<!\r)\n/)
		expect(autoexec).not.toMatch(/(?<!\r)\n/)
		expect(renderWindows98DisableFloppyScript()).not.toMatch(/(?<!\r)\n/)
	})

	test('terminates bootfix removal before mapping unattended files', () => {
		expect(
			buildXorrisoEditArgs('/source.iso', '/install.iso', 'I386/BOOTFIX.BIN', [
				['/overlay/WINNT.SIF', '/I386/WINNT.SIF'],
			]),
		).toEqual([
			'-return_with',
			'FAILURE',
			'32',
			'-indev',
			'/source.iso',
			'-outdev',
			'/install.iso',
			'-boot_image',
			'any',
			'replay',
			'-rm_r',
			'/I386/BOOTFIX.BIN',
			'--',
			'-map',
			'/overlay/WINNT.SIF',
			'/I386/WINNT.SIF',
		])
	})

	test('rebuilds modern Windows media as bootable UDF with the no-prompt EFI image', () => {
		const args = buildGenisoimageArgs('/mnt/windows', '/install.iso', 'windows-11', [
			['/overlay/autounattend.xml', '/autounattend.xml'],
			['/overlay/drivers', '/$WinPEDriver$'],
		])
		expect(args).toContain('-udf')
		expect(args).toContain('-allow-limited-size')
		expect(args).toContain('boot/etfsboot.com')
		expect(args).toContain('efi/microsoft/boot/efisys_noprompt.bin')
		expect(args).toContain('/=/mnt/windows')
		expect(args).toContain('autounattend.xml=/overlay/autounattend.xml')
		expect(args).toContain('$WinPEDriver$=/overlay/drivers')
	})

	test('omits the UEFI boot entry for BIOS-only Windows 7 media', () => {
		const args = buildGenisoimageArgs('/mnt/windows', '/install.iso', 'windows-7', [
			['/overlay/SetupComplete.cmd', '/sources/$OEM$/$$/Setup/Scripts/SetupComplete.cmd'],
		])
		expect(args).not.toContain('-eltorito-alt-boot')
		expect(args).not.toContain('efi/microsoft/boot/efisys_noprompt.bin')
		expect(args).toContain('sources/$OEM$/$$/Setup/Scripts/SetupComplete.cmd=/overlay/SetupComplete.cmd')
	})

	test('reconstructs a hidden legacy El Torito boot image', () => {
		expect(
			parseLegacyElToritoReport(`El Torito catalog  : 19  1
El Torito images   :   N  Pltf  B   Emul  Ld_seg  Hdpt  Ldsiz         LBA
El Torito boot img :   1  BIOS  y   none  0x0000  0x00      4         345
El Torito img blks :   1  1`),
		).toEqual({emulation: 'no_emulation', loadSize: 2048, floppyImageSize: undefined})
		expect(
			parseLegacyElToritoReport(`El Torito boot img :   1  BIOS  y  fd1.4  0x0000  0x00      1          21`),
		).toEqual({emulation: 'diskette', loadSize: 512, floppyImageSize: 1_474_560})

		const args = buildXorrisoEditArgs(
			'/source.iso',
			'/install.iso',
			undefined,
			[['/overlay/boot.img', '/.umbrel-boot/boot.img']],
			{
				isoPath: '/.umbrel-boot/boot.img',
				emulation: 'no_emulation',
				loadSize: 2048,
			},
		)
		expect(args).toContain('discard')
		expect(args).not.toContain('replay')
		expect(args).toContain('off')
		expect(args).toContain('full_ascii:omit_version:no_force_dots')
		expect(args.indexOf('-ecma119_map')).toBeLessThan(args.indexOf('-indev'))
		expect(args).toContain('uppercase')
		expect(args).toContain('bin_path=/.umbrel-boot/boot.img')
		expect(args).toContain('emul_type=no_emulation')
		expect(args).toContain('load_size=2048')
		expect(args).toContain('sort_weight')
	})
})
