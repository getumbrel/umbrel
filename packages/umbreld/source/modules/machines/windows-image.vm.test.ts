import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import type {WindowsInstallOptions} from './windows-image.ts'

// Where umbreld keeps downloaded install media and the machines made from it
const images = '/home/umbrel/umbrel/machine-images/vm-test'
const machine = '/home/umbrel/umbrel/machines/vm-test'

// Prepares install media with umbreld's own code on the device, using the
// real tools of the OS image, and prints how it went
const guestRunner = '/root/prepare-windows-media.mjs'
const runner = `
import {prepareWindowsInstallMedia} from '/opt/umbreld/source/modules/machines/windows-image.ts'

const [source, destination, options] = process.argv.slice(2)
try {
	await prepareWindowsInstallMedia(source, destination, JSON.parse(options), new AbortController().signal)
	process.stdout.write('prepared')
} catch (error) {
	process.stdout.write('failed: ' + error.message)
}
`

// Windows media can't be shipped with the tests, so these stand in for it:
// discs laid out as each installer's is, down to how they boot, holding
// placeholder files
const buildMedia = `
set -eu
mkdir -p '${images}' '${machine}'
tree=$(mktemp -d)

# Windows 11, Server 2025 and 7: booted through El Torito images in boot/ and efi/
mkdir -p "$tree/modern/boot" "$tree/modern/efi/microsoft/boot" "$tree/modern/efi/boot" "$tree/modern/sources"
head -c 4096 /dev/urandom > "$tree/modern/boot/etfsboot.com"
head -c 4096 /dev/urandom > "$tree/modern/efi/microsoft/boot/efisys_noprompt.bin"
head -c 4096 /dev/urandom > "$tree/modern/efi/boot/bootaa64.efi"
head -c 1M /dev/urandom > "$tree/modern/sources/install.wim"
printf 'setup' > "$tree/modern/setup.exe"
genisoimage -quiet -J -R -V WINDOWS -o '${images}/modern.iso' "$tree/modern"

# The same disc without the files it boots from
mkdir -p "$tree/incomplete/sources"
printf 'setup' > "$tree/incomplete/setup.exe"
genisoimage -quiet -J -R -V WINDOWS -o '${images}/incomplete.iso' "$tree/incomplete"

# Windows XP: plain ISO 9660 with a boot image loaded without emulation
mkdir -p "$tree/xp/I386"
printf 'setup' > "$tree/xp/I386/SETUP.EXE"
head -c 2048 /dev/urandom > "$tree/xp/BOOT.BIN"
genisoimage -quiet -b BOOT.BIN -no-emul-boot -boot-load-size 4 -c BOOT.CAT -o '${images}/xp.iso' "$tree/xp"

# The virtio driver disc, with a driver in each folder umbreld takes from it.
# The real disc hard links its Windows 11 folders to the Server 2025 ones; a
# disc made here can't be told which of the two is the link, so these are copies.
for driver in amd64/w11 viogpudo/2k25/amd64 viogpudo/w11/amd64 NetKVM/2k25/amd64 Balloon/2k25/amd64 \
	viostor/2k25/ARM64 viostor/w11/ARM64 NetKVM/2k25/ARM64 NetKVM/w11/ARM64 Balloon/2k25/ARM64 Balloon/w11/ARM64; do
	mkdir -p "$tree/virtio/$driver"
	printf '%s' "$driver" > "$tree/virtio/$driver/driver.inf"
done
printf 'readme' > "$tree/virtio/NetKVM/2k25/amd64/Readme.md"
printf 'guest tools' > "$tree/virtio/virtio-win-guest-tools.exe"
genisoimage -quiet -J -R -V VIRTIO -o '${images}/virtio.iso' "$tree/virtio"

rm -rf "$tree"
sha256sum '${images}'/*.iso
`

const account = {username: 'satoshi', password: 'moneyprintergobrrr', completionUrl: 'http://10.203.0.1/done'}

describe.sequential('Windows install media', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let mediaHashes: string

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
		await umbreld.vm.sshAsRoot(`cat > ${guestRunner} <<'RUNNER'\n${runner}\nRUNNER`)
		mediaHashes = await umbreld.vm.sshAsRoot(buildMedia)
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	const prepare = (source: string, destination: string, options: Partial<WindowsInstallOptions>) =>
		umbreld.vm.sshAsRoot(
			`node ${guestRunner} '${images}/${source}' '${machine}/${destination}' '${JSON.stringify({...account, ...options})}'`,
		)

	// The paths on a disc, in lower case
	const discListing = async (disc: string) =>
		(await umbreld.vm.sshAsRoot(`bsdtar -tf '${machine}/${disc}'`)).toLowerCase().split('\n')
	const discFile = (disc: string, path: string) => umbreld.vm.sshAsRoot(`bsdtar -xOf '${machine}/${disc}' '${path}'`)

	// What preparing media must not leave behind: its working folder, the mount
	// of the source disc inside it, and any change to the downloaded media
	const expectCleanedUp = async () => {
		expect(await umbreld.vm.sshAsRoot(`ls -d '${machine}'/*.overlay 2>/dev/null || true`)).toBe('')
		expect(
			await umbreld.vm.sshAsRoot(`findmnt --raw --noheadings --output TARGET | grep -c '${machine}' || true`),
		).toBe('0')
		expect(await umbreld.vm.sshAsRoot(`losetup --list --noheadings --output BACK-FILE | grep -c vm-test || true`)).toBe(
			'0',
		)
		expect(await umbreld.vm.sshAsRoot(`sha256sum '${images}'/*.iso`)).toBe(mediaHashes)
	}

	test('prepares Windows 11 media that installs unattended with virtio drivers', async () => {
		await expect(
			prepare('modern.iso', 'windows-11.iso', {
				installer: 'windows-11',
				arch: 'amd64',
				virtioIso: `${images}/virtio.iso`,
			}),
		).resolves.toBe('prepared')

		const listing = await discListing('windows-11.iso')
		// The installer, as it was
		expect(listing).toEqual(expect.arrayContaining(['setup.exe', 'sources/install.wim', 'boot/etfsboot.com']))
		// The answer file, the drivers Windows Setup loads and the guest tools it installs
		expect(listing).toEqual(
			expect.arrayContaining([
				'autounattend.xml',
				'$winpedriver$/storage/driver.inf',
				'$winpedriver$/network/driver.inf',
				'$winpedriver$/balloon/driver.inf',
				'$winpedriver$/display/driver.inf',
				'sources/$oem$/$$/setup/umbrel/virtio-win-guest-tools.exe',
			]),
		)
		expect(await discFile('windows-11.iso', 'autounattend.xml')).toContain(account.username)
		expect(await discFile('windows-11.iso', '$WinPEDriver$/storage/driver.inf')).toBe('amd64/w11')
		expect(await discFile('windows-11.iso', '$WinPEDriver$/display/driver.inf')).toBe('viogpudo/w11/amd64')
		// It boots from the same images
		const boot = await umbreld.vm.sshAsRoot(
			`xorriso -indev '${machine}/windows-11.iso' -report_el_torito plain 2>/dev/null`,
		)
		expect(boot).toMatch(/El Torito boot img\s*:\s*1\s+BIOS/)
		expect(boot).toMatch(/El Torito boot img\s*:\s*2\s+UEFI/)

		await expectCleanedUp()
	})

	test('prepares Windows 7 media with its setup script', async () => {
		await expect(prepare('modern.iso', 'windows-7.iso', {installer: 'windows-7', arch: 'amd64'})).resolves.toBe(
			'prepared',
		)

		const listing = await discListing('windows-7.iso')
		expect(listing).toEqual(
			expect.arrayContaining([
				'setup.exe',
				'sources/install.wim',
				'autounattend.xml',
				'sources/$oem$/$$/setup/scripts/setupcomplete.cmd',
			]),
		)
		await expectCleanedUp()
	})

	test('prepares Windows 11 for Arm media as a USB drive', async () => {
		await expect(
			prepare('modern.iso', 'windows-11-arm.img', {
				installer: 'windows-11',
				arch: 'arm64',
				virtioIso: `${images}/virtio.iso`,
			}),
		).resolves.toBe('prepared')

		// A FAT32 drive holding the installer, the answer file and the drivers
		const listing = (await umbreld.vm.sshAsRoot(`MTOOLS_SKIP_CHECK=1 mdir -/ -b -i '${machine}/windows-11-arm.img' ::`))
			.toLowerCase()
			.split('\n')
		expect(listing).toEqual(
			expect.arrayContaining([
				'::/setup.exe',
				'::/efi/boot/bootaa64.efi',
				'::/sources/install.wim',
				'::/autounattend.xml',
				'::/$winpedriver$/storage/driver.inf',
				'::/$winpedriver$/network/driver.inf',
				'::/$winpedriver$/balloon/driver.inf',
			]),
		)
		expect(await umbreld.vm.sshAsRoot(`blkid --output value --match-tag TYPE '${machine}/windows-11-arm.img'`)).toBe(
			'vfat',
		)
		await expectCleanedUp()
	})

	test('prepares Windows XP media with its answer file, still bootable', async () => {
		await expect(
			prepare('xp.iso', 'windows-xp.iso', {
				installer: 'windows-xp',
				arch: 'amd64',
				licenseKey: 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE',
			}),
		).resolves.toBe('prepared')

		const listing = await discListing('windows-xp.iso')
		expect(listing).toEqual(expect.arrayContaining(['i386/setup.exe', 'i386/winnt.sif', 'i386/umbrel.vbs']))
		expect(await discFile('windows-xp.iso', 'I386/UMBREL.VBS')).toContain(account.username)
		// It boots as the original did: one BIOS image, loaded without emulation
		const boot = await umbreld.vm.sshAsRoot(
			`xorriso -indev '${machine}/windows-xp.iso' -report_el_torito plain 2>/dev/null`,
		)
		expect(boot).toMatch(/El Torito boot img\s*:\s*1\s+BIOS\s+y\s+none\s+\S+\s+\S+\s+4\s/)
		await expectCleanedUp()
	})

	test('refuses media that is not the installer, leaving nothing behind', async () => {
		await expect(
			prepare('incomplete.iso', 'incomplete-out.iso', {installer: 'windows-11', arch: 'amd64'}),
		).resolves.toBe('failed: [machine-windows-source-invalid]')
		expect(await umbreld.vm.sshAsRoot(`ls '${machine}/incomplete-out.iso' 2>/dev/null || true`)).toBe('')
		await expectCleanedUp()
	})
})
