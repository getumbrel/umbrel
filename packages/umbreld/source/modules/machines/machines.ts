import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto'
import {readFileSync} from 'node:fs'
import fsp from 'node:fs/promises'
import dgram from 'node:dgram'
import net from 'node:net'
import os from 'node:os'
import nodePath from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

import {execa} from 'execa'
import fse from 'fs-extra'
import PQueue from 'p-queue'
import yaml from 'js-yaml'
import {z} from 'zod'

import type Umbreld from '../../index.ts'

import {getAppPids} from '../system/system.ts'
import {OWNER_USER_ID} from '../user/constants.ts'
import {
	architectureForProfile,
	defaultMachineType,
	defaultPlatformProfile,
	hostArchitecture,
	isLegacyPlatformProfile,
	MACHINE_LAN_BRIDGE,
	machineDiskTarget,
	machineJoinsLan,
	resolveAcceleration,
	type MachineArchitecture,
	type MachineDefinition,
	type MachineNetworkMode,
	type PlatformProfile,
	type PortForward,
} from './domain.ts'
import LanBridge from './lan-bridge.ts'
import Libvirt, {QEMU_GIBIBYTE_BYTES, qemuImageFormatForPath, type QemuImageFormat} from './libvirt.ts'
import {machineIdCandidate, slugifyMachineId} from './machine-id.ts'
import {MACHINE_GUEST_HOST_ADDRESS, machineIpAddressSchema, nextMachineIpAddress} from './machine-network.ts'
import MachineStore, {MAX_MACHINE_USB_DEVICE_ALIASES} from './machine-store.ts'
import {safeDownload} from './safe-download.ts'
import {prepareWindowsInstallMedia, type WindowsInstaller} from './windows-image.ts'
import {prepareOmarchySeed, probeOmarchySetup, removeOmarchySetupCredentials} from './omarchy-install.ts'
import MachineGuestApi from './guest-api.ts'
import {encodeScreenshot, performInputAction, type MachineInputAction, type PointerTarget} from './machine-control.ts'
import type {InputFeedback, PointerMotion} from './input-motion.ts'
import RfbClient from './rfb-client.ts'
import {installCommandOptions, MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS} from './install-command.ts'
import {
	listHostUsbDevices,
	planUsbAssignments,
	resolveUsbAssignments,
	sameUsbAddress,
	sameUsbDevice,
	usbDeviceReplacing,
	usbDriveDisks,
	usbHostUse,
	usbReservationRules,
	usbTopologyFingerprint,
	type HostUsbDevice,
	type UsbAddress,
	type UsbDeviceAssignment,
	type UsbDeviceIdentity,
	type UsbHostUse,
} from './usb-devices.ts'

export const FIRST_BOOT_SETUP_TIMEOUT_MS = 60 * 60 * 1_000
const JOIN_LAN_AFTER_SETUP_DELAY_MS = 2_000
export const WINDOWS_ARM_FIRST_BOOT_SETUP_TIMEOUT_MS = 4 * FIRST_BOOT_SETUP_TIMEOUT_MS
// Guests need a moment to react before the screenshot that follows an input
// action, otherwise the caller sees the screen from before it acted
export const MACHINE_INPUT_SETTLE_MS = 1_000
// How often to look again at assigned USB devices the host was using
const USB_RETRY_INTERVAL_MS = 5_000
// How soon after a machine's USB device disconnects a different one showing
// up in the same port counts as the device reconnecting as another model.
// Devices that do this come back within a second or two.
const USB_REENUMERATION_WINDOW_MS = 10_000
// How long the host can take to find a drive's disks again once a machine
// lets go of it
const USB_DRIVE_RELEASE_TIMEOUT_MS = 10_000
// udev rules keeping the host's services away from devices assigned to
// machines. udev reads rules from /run as well as /etc, and since nothing
// written outside /home survives a reboot on umbrelOS, umbreld writes them
// afresh every time it starts.
const USB_RESERVATION_RULES_PATH = '/run/udev/rules.d/90-umbrel-machines-usb.rules'
// A machine counts as driven by an agent for this long after its last input.
// The console shows who is at the controls and asks before letting a person
// interfere, then hands control back once the agent has gone quiet.
export const AGENT_CONTROL_TIMEOUT_MS = 60_000
const agentControlTimeoutMs = () =>
	Number(process.env.UMBREL_MACHINE_AGENT_CONTROL_TIMEOUT_MS) || AGENT_CONTROL_TIMEOUT_MS

// Who is behind an MCP credential, as far as the console needs to say so
export type MachineAgent = {
	tokenId: string
	label: string
	agentType?: string
	clientName?: string
}

export type MachineAgentControl = {
	agent: MachineAgent
	lastInputAt: number
	// Snapshot age is expressed in the server's clock so clients need not
	// assume that the browser and Umbrel agree about wall-clock time.
	observedAt: number
	sequence: number
	feedback?: InputFeedback & {startedAt: number}
	// The agent's pointer in guest pixels together with the framebuffer size it
	// was placed on, so a viewer can scale it onto whatever the console shows.
	// While the pointer is travelling this is its destination, announced as it
	// sets off with how long the journey takes, so a viewer can move in step.
	pointer?: PointerTarget & {width: number; height: number; motion?: PointerMotion}
}

export type MachineAgentControlEvent = {
	machineId: string
	control: MachineAgentControl | null
}

export type MachineState =
	| 'installing'
	| 'stopped'
	| 'starting'
	| 'running'
	| 'stopping'
	| 'restarting'
	| 'suspended'
	| 'error'
export type MachineInstallationState = 'preparing' | 'starting' | 'setting-up' | 'setup-delayed' | 'ready-for-setup'

export type Machine = {
	id: string
	name: string
	osId: string
	osName: string
	osVersion: string
	osVariant?: string
	state: MachineState
	installationState?: MachineInstallationState
	installProgress?: number
	installOsId?: string
	errorMessage?: string
	diskSizeGb: number
	cores: number
	memoryGb: number
	storageUsedGb: number
	networkMode: MachineNetworkMode
	ipAddress: string
	username?: string
	arch: MachineArchitecture
	platformProfile: PlatformProfile
	firmware: 'uefi' | 'bios'
	diskBus?: 'virtio' | 'sata'
	diskPath?: string
	acceleration: 'kvm' | 'tcg'
	performanceWarning?: string
	portForwards: PortForward[]
	usbDevices: UsbDeviceAssignment[]
	autostart: boolean
	pinned: boolean
	createdAt: number
	firstBootSetup: boolean
	installPending: boolean
	installationMediaAttached: boolean
}

// Why Umbrel won't simply hand a USB device to a machine
export type MachineUsbHostUse = {
	reason: UsbHostUse['reason']
	// The apps using it, when only apps are
	apps?: Array<{id: string; name: string}>
	// Whether a machine can still have it once the user agrees. A drive in Files
	// is ejected first, and apps using a device through a driver see it
	// unplugged. Nothing else is ever taken from the host.
	takeable: boolean
}

// A USB device plugged into Umbrel, or one assigned to a machine but not
// plugged in right now
export type MachineUsbDevice = UsbDeviceAssignment & {
	manufacturer?: string
	connected: boolean
	// The machine it is assigned to
	machineId?: string
	hostUse?: MachineUsbHostUse
}

// A device requested for a machine. Taking it from the host is the user
// agreeing to eject it from Files or take it from the apps using it.

export type OsImageState = 'available' | 'downloading' | 'downloaded' | 'failed'
export type OsArchitecture = MachineArchitecture

export type MachineResourceUsage = {
	id: string
	name: string
	osId: string
	used: number
}

export type OsImage = {
	id: string
	familyId: string
	name: string
	variantName?: string
	version: string
	sizeMb: number
	estimatedInstalledSizeMb?: number
	arch: OsArchitecture
	platform?: 'linux' | 'windows'
	requiresCredentials: boolean
	custom?: boolean
	state: OsImageState
	downloadProgress?: number
	downloadedMb?: number
	errorMessage?: string
	evaluation?: boolean
	manualSetup?: boolean
	requiresLicenseKey?: boolean
	// Setup only accepts product keys from the licensing channel its media was
	// built for, so a genuine retail key fails on OEM or Volume License media
	licenseChannel?: 'oem' | 'volume'
}

type ImageResource = {id: string; url: string; sha256: string; fileName: string}

type InternalOsImage = OsImage & {
	sourceUrl?: string
	sha256?: string
	fileName?: string
	diskFormat?: QemuImageFormat
	platformProfile?: PlatformProfile
	cloudInit?: CloudInitProvisioning
	fixedMemoryMb?: number
	windows?: {installer: WindowsInstaller}
	resources?: ImageResource[]
}

type CloudInitProvisioning = {
	shell?: string
	// The distro's administrator group. Sudo access comes from the sudoers rule,
	// but polkit only treats members of this group as administrators, so the
	// desktop rejects the user's password for admin actions without it.
	adminGroup?: 'sudo' | 'wheel'
	packages?: string[]
	commands?: string[][]
	graphical?: boolean
}

type BackupJournal = {
	version: 1
	machineId: string
	phase: 'preparing' | 'pivoted' | 'committing'
	overlay: string
	nvramLive?: string
	tpmLive?: string
}

type MachineInstallCredentials = {username?: string; password?: string; licenseKey?: string; firstBootToken?: string}

type ImageDownloadJob = {
	controller: AbortController
	consumers: Set<string>
	promise: Promise<void>
}

type MachineInstallJob = {
	controller: AbortController
	promise: Promise<void>
}

export function requiredMachineCreationBytes(diskSizeGb: number, imageSizeMb: number) {
	return diskSizeGb * 1_000_000_000 + imageSizeMb * 1_000_000
}

const catalogSchema = z.object({
	version: z.literal(1),
	images: z.array(
		z.object({
			id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/i),
			familyId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/i),
			name: z.string(),
			variantName: z.string().optional(),
			version: z.string(),
			sizeMb: z.number().positive(),
			estimatedInstalledSizeMb: z.number().positive().optional(),
			arch: z.enum(['amd64', 'arm64']),
			platform: z.enum(['linux', 'windows']),
			requiresCredentials: z.boolean(),
			url: z.string().url(),
			sha256: z.string().regex(/^[0-9a-f]{64}$/i),
			diskFormat: z.enum(['qcow2', 'raw', 'vmdk', 'vdi', 'vhdx', 'vpc']).optional(),
			platformProfile: z.enum(['modern-x86', 'windows-7-x86', 'legacy-x86', 'windows-98-x86', 'modern-arm64']),
			fixedMemoryMb: z.number().int().min(128).max(1_048_576).optional(),
			evaluation: z.boolean().optional(),
			manualSetup: z.boolean().optional(),
			licenseChannel: z.enum(['oem', 'volume']).optional(),
			windows: z
				.object({installer: z.enum(['windows-11', 'windows-server-2025', 'windows-7', 'windows-xp', 'windows-98'])})
				.optional(),
			resources: z
				.array(
					z.object({
						id: z.string().min(1),
						url: z.string().url(),
						sha256: z.string().regex(/^[0-9a-f]{64}$/i),
						fileName: z.string().regex(/^[a-z0-9._-]+$/i),
					}),
				)
				.optional(),
			cloudInit: z
				.object({
					shell: z.string().startsWith('/').optional(),
					adminGroup: z.enum(['sudo', 'wheel']).optional(),
					packages: z.array(z.string().min(1)).optional(),
					commands: z.array(z.array(z.string().min(1)).min(1)).optional(),
					graphical: z.boolean().optional(),
				})
				.optional(),
		}),
	),
})

// Debian's desktop task installs NetworkManager. If its service starts during
// apt, it takes the cloud image's NIC away from systemd-networkd mid-download.
// Defer service starts until the transaction is complete, then leave a DHCP
// profile ready for NetworkManager to take over on the reboot.
const DEBIAN_DESKTOP_INSTALL = `set -euxo pipefail
policy=/usr/sbin/policy-rc.d
policy_backup=/run/umbrel-policy-rc.d.backup
had_policy=false
if [ -e "$policy" ]; then
	cp -a "$policy" "$policy_backup"
	had_policy=true
fi
restore_policy() {
	if [ "$had_policy" = true ]; then
		mv -f "$policy_backup" "$policy"
	else
		rm -f "$policy"
	fi
}
trap restore_policy EXIT
printf '#!/bin/sh\\nexit 101\\n' > "$policy"
chmod 0755 "$policy"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y task-gnome-desktop spice-vdagent

cat > /etc/netplan/99-umbrel-desktop.yaml <<EOF
network:
  version: 2
  renderer: NetworkManager
EOF
chmod 0600 /etc/netplan/99-umbrel-desktop.yaml
netplan generate

restore_policy
trap - EXIT
systemctl disable systemd-networkd.service systemd-networkd-wait-online.service || true
systemctl enable NetworkManager.service gdm3.service`

// Android does not have a reliable, generic disk image that boots well on
// both QEMU architectures. Keep the outer guest portable by using the pinned
// Ubuntu cloud image, then boot directly into Waydroid's native-architecture
// LineageOS image through a minimal Cage session. The Linux layer remains
// available over SSH for recovery, but is not exposed in the graphical flow.
// Runs inside the Android guest after Waydroid's first boot; kept as a file so
// it stays readable and free of template-literal escaping.
const WAYDROID_DOCK_SCRIPT = readFileSync(new URL('./waydroid-dock.py', import.meta.url), 'utf8').trimEnd()

const ANDROID_INSTALL = `set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
android_user="$(getent passwd 1000 | cut -d: -f1)"
test -n "$android_user"

apt-get update
apt-get install -y curl ca-certificates
curl --proto '=https' --tlsv1.2 -fsSLo /usr/share/keyrings/waydroid.gpg https://repo.waydro.id/waydroid.gpg
printf 'deb [signed-by=/usr/share/keyrings/waydroid.gpg] https://repo.waydro.id/ resolute main\n' > /etc/apt/sources.list.d/waydroid.list
apt-get update
apt-get install -y cage greetd dbus-user-session pipewire-pulse waydroid

printf 'options binder_linux devices=binder,hwbinder,vndbinder\n' > /etc/modprobe.d/waydroid.conf
printf 'binder_linux\n' > /etc/modules-load.d/waydroid.conf
modprobe binder_linux
waydroid init -s GAPPS

# QEMU virgl gives Waydroid native Mesa rendering. On hosts without a render
# node, fall back to software in both the compositor and Android rather than
# leaving the machine at a black screen.
if ! find /dev/dri -maxdepth 1 -name 'renderD*' -print -quit 2>/dev/null | grep -q .; then
	sed -i '/^\\[properties\\]$/a ro.hardware.gralloc=default' /var/lib/waydroid/waydroid.cfg
	sed -i '/^\\[properties\\]$/a ro.hardware.egl=swiftshader' /var/lib/waydroid/waydroid.cfg
fi
# Match the phone-shaped 720x1560 scanout the host gives Android machines.
sed -i '/^\\[properties\\]$/a ro.sf.lcd_density=320' /var/lib/waydroid/waydroid.cfg
# Waydroid only folds [properties] into waydroid_base.prop during init or an
# upgrade, so regenerate it offline now that the overrides are in place.
waydroid upgrade -o

# Most Play apps that ship native code ship it for ARM only, because Play has
# never required an x86 build, so on an x86_64 host those apps refuse to
# install. A translation layer fixes that on both Intel and AMD; ARM hosts run
# the same apps natively and need nothing. Treat it as a bonus rather than
# part of the machine: an upstream change, a slow mirror or a dead URL must
# never be the reason someone's Android machine fails to install, so the
# attempt is time-boxed and its failure is logged and ignored.
if [ "$(uname -m)" = x86_64 ]; then
	cat > /usr/local/bin/umbrel-waydroid-arm-translation <<'EOF'
#!/bin/bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get install -y --no-install-recommends git lzip python3-venv
rm -rf /opt/waydroid-script
git clone --no-checkout https://github.com/casualsnek/waydroid_script /opt/waydroid-script
git -C /opt/waydroid-script checkout d5289cfd8929e86e7f0dc89ecadcef8b66930eec
python3 -m venv /opt/waydroid-script/venv
/opt/waydroid-script/venv/bin/pip install --disable-pip-version-check -r /opt/waydroid-script/requirements.txt
# Some ARM apps, including Grab, fail to load native methods with libndk on
# Intel. Use libhoudini there, keeping libndk for other x86 hosts.
translation=libndk
if grep -q '^vendor_id[[:space:]]*:[[:space:]]*GenuineIntel' /proc/cpuinfo; then
	translation=libhoudini
fi
/opt/waydroid-script/venv/bin/python3 - -a 13 install "$translation" <<'PY'
import sys
sys.path.insert(0, "/opt/waydroid-script")
from main import main
from stuff.houdini import Houdini

# The pinned helper's Android 13 default is an HPE 14 build with date-triggered
# freezes. Use the Android 13 translator from ChromeOS Octopus R144 instead.
Houdini.dl_links["13"] = [
    "https://github.com/supremegamers/vendor_intel_proprietary_houdini/archive/120fe811684c938de9d123a1423b7f9f8f572f7d.zip",
    "b9b0206bb1c84b1588ee6757d11a89a9",
]
main()
PY
EOF
	chmod 0755 /usr/local/bin/umbrel-waydroid-arm-translation
	timeout 900 /usr/local/bin/umbrel-waydroid-arm-translation ||
		echo 'umbrel: ARM app translation unavailable, continuing without it' >&2
fi

cat > /usr/local/bin/umbrel-waydroid-session <<'EOF'
#!/bin/sh
set -eu
# virglrenderer before !1611 flips GL-rendered hardware cursors when QEMU reads
# them back, so the console shows an upside-down arrow whose tip sits below the
# real pointer. Composite the cursor in the guest instead.
export WLR_NO_HARDWARE_CURSORS=1
if ! find /dev/dri -maxdepth 1 -name 'renderD*' -print -quit 2>/dev/null | grep -q .; then
	export WLR_RENDERER=pixman
fi
for attempt in $(seq 1 60); do
	systemctl is-active --quiet waydroid-container && break
	sleep 1
done
exec dbus-run-session cage -s -- waydroid show-full-ui
EOF
chmod 0755 /usr/local/bin/umbrel-waydroid-session

cat > /etc/greetd/config.toml <<EOF
[terminal]
vt = 7

[default_session]
command = "/usr/local/bin/umbrel-waydroid-session"
user = "$android_user"
EOF

# Trebuchet's phone layout leaves Waydroid's dock with a hole and a duplicate
# (see the script). Tidy it once, on first boot, and only if it is untouched.
cat > /usr/local/bin/umbrel-waydroid-dock <<'EOF'
${WAYDROID_DOCK_SCRIPT}
EOF
chmod 0755 /usr/local/bin/umbrel-waydroid-dock
cat > /etc/systemd/system/umbrel-waydroid-dock.service <<EOF
[Unit]
Description=Tidy the Waydroid first-boot dock
After=waydroid-container.service greetd.service
ConditionPathExists=!/var/lib/waydroid/.umbrel-dock

[Service]
Type=oneshot
ExecStart=/usr/local/bin/umbrel-waydroid-dock

[Install]
WantedBy=graphical.target
EOF

systemctl enable greetd.service waydroid-container.service umbrel-waydroid-dock.service
systemctl set-default graphical.target`

// Shipped with umbrelOS so the catalog works without runtime configuration or
// an Umbrel-operated service. Images are pinned to immutable upstream release
// artifacts and verified before being persisted.
export const builtinMachinesCatalog = catalogSchema.parse({
	version: 1,
	images: [
		{
			id: 'ubuntu-26.04-desktop-amd64',
			familyId: 'ubuntu',
			name: 'Ubuntu',
			variantName: 'Desktop',
			version: 'Ubuntu 26.04 LTS',
			sizeMb: 859,
			estimatedInstalledSizeMb: 5_000,
			arch: 'amd64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://cloud-images.ubuntu.com/releases/resolute/release-20260627/ubuntu-26.04-server-cloudimg-amd64.img',
			sha256: '3ee4f67f322abb2d1d1f0fffc957f7411404ad6635dd35b026c8ff05ac6e534c',
			diskFormat: 'qcow2',
			platformProfile: 'modern-x86',
			cloudInit: {adminGroup: 'sudo', packages: ['ubuntu-desktop', 'spice-vdagent'], graphical: true},
		},
		{
			id: 'ubuntu-26.04-server-amd64',
			familyId: 'ubuntu',
			name: 'Ubuntu',
			variantName: 'Server',
			version: 'Ubuntu 26.04 LTS',
			sizeMb: 859,
			arch: 'amd64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://cloud-images.ubuntu.com/releases/resolute/release-20260627/ubuntu-26.04-server-cloudimg-amd64.img',
			sha256: '3ee4f67f322abb2d1d1f0fffc957f7411404ad6635dd35b026c8ff05ac6e534c',
			diskFormat: 'qcow2',
			platformProfile: 'modern-x86',
			cloudInit: {adminGroup: 'sudo'},
		},
		{
			id: 'ubuntu-26.04-desktop-arm64',
			familyId: 'ubuntu',
			name: 'Ubuntu',
			variantName: 'Desktop',
			version: 'Ubuntu 26.04 LTS',
			sizeMb: 940,
			estimatedInstalledSizeMb: 7_900,
			arch: 'arm64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://cloud-images.ubuntu.com/releases/resolute/release-20260627/ubuntu-26.04-server-cloudimg-arm64.img',
			sha256: '3d8db37fa9a8a0c8676dfc0ee3eb41fd0049d66cb055a792bddc8f4123443ae1',
			diskFormat: 'qcow2',
			platformProfile: 'modern-arm64',
			cloudInit: {adminGroup: 'sudo', packages: ['ubuntu-desktop', 'spice-vdagent'], graphical: true},
		},
		{
			id: 'ubuntu-26.04-server-arm64',
			familyId: 'ubuntu',
			name: 'Ubuntu',
			variantName: 'Server',
			version: 'Ubuntu 26.04 LTS',
			sizeMb: 940,
			arch: 'arm64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://cloud-images.ubuntu.com/releases/resolute/release-20260627/ubuntu-26.04-server-cloudimg-arm64.img',
			sha256: '3d8db37fa9a8a0c8676dfc0ee3eb41fd0049d66cb055a792bddc8f4123443ae1',
			diskFormat: 'qcow2',
			platformProfile: 'modern-arm64',
			cloudInit: {adminGroup: 'sudo'},
		},
		{
			id: 'fedora-44-desktop-amd64',
			familyId: 'fedora',
			name: 'Fedora',
			variantName: 'Desktop',
			version: 'Fedora 44',
			sizeMb: 584,
			estimatedInstalledSizeMb: 6_200,
			arch: 'amd64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://download.fedoraproject.org/pub/fedora/linux/releases/44/Cloud/x86_64/images/Fedora-Cloud-Base-Generic-44-1.7.x86_64.qcow2',
			sha256: '28680fe5b371a5a82ebf43a31926e086a168e59949d03969c5093e7071f90b7f',
			platformProfile: 'modern-x86',
			// Cloud Base only ships kernel-core, and the HDA sound drivers live in
			// kernel-modules, which the Workstation group doesn't pull in.
			cloudInit: {
				adminGroup: 'wheel',
				commands: [
					['dnf', 'install', '-y', '@workstation-product-environment', 'kernel-modules'],
					['systemctl', 'enable', 'gdm.service'],
				],
				graphical: true,
			},
		},
		{
			id: 'fedora-44-server-amd64',
			familyId: 'fedora',
			name: 'Fedora',
			variantName: 'Server',
			version: 'Fedora 44',
			sizeMb: 584,
			arch: 'amd64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://download.fedoraproject.org/pub/fedora/linux/releases/44/Cloud/x86_64/images/Fedora-Cloud-Base-Generic-44-1.7.x86_64.qcow2',
			sha256: '28680fe5b371a5a82ebf43a31926e086a168e59949d03969c5093e7071f90b7f',
			platformProfile: 'modern-x86',
			cloudInit: {adminGroup: 'wheel'},
		},
		{
			id: 'fedora-44-desktop-arm64',
			familyId: 'fedora',
			name: 'Fedora',
			variantName: 'Desktop',
			version: 'Fedora 44',
			sizeMb: 528,
			estimatedInstalledSizeMb: 7_200,
			arch: 'arm64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://download.fedoraproject.org/pub/fedora/linux/releases/44/Cloud/aarch64/images/Fedora-Cloud-Base-Generic-44-1.7.aarch64.qcow2',
			sha256: '55c60a3b80d3616a08705afd0459e75fe9f03c54aba7a46e4002a41a72fa0d5b',
			platformProfile: 'modern-arm64',
			cloudInit: {
				adminGroup: 'wheel',
				commands: [
					['dnf', 'install', '-y', '@workstation-product-environment', 'kernel-modules'],
					['systemctl', 'enable', 'gdm.service'],
				],
				graphical: true,
			},
		},
		{
			id: 'fedora-44-server-arm64',
			familyId: 'fedora',
			name: 'Fedora',
			variantName: 'Server',
			version: 'Fedora 44',
			sizeMb: 528,
			arch: 'arm64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://download.fedoraproject.org/pub/fedora/linux/releases/44/Cloud/aarch64/images/Fedora-Cloud-Base-Generic-44-1.7.aarch64.qcow2',
			sha256: '55c60a3b80d3616a08705afd0459e75fe9f03c54aba7a46e4002a41a72fa0d5b',
			platformProfile: 'modern-arm64',
			cloudInit: {adminGroup: 'wheel'},
		},
		{
			id: 'debian-13-desktop-amd64',
			familyId: 'debian',
			name: 'Debian',
			variantName: 'Desktop',
			version: 'Debian 13',
			sizeMb: 437,
			estimatedInstalledSizeMb: 3_400,
			arch: 'amd64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://cloud.debian.org/images/cloud/trixie/20260706-2531/debian-13-generic-amd64-20260706-2531.qcow2',
			sha256: '7568c141e73c83eca7882625fafb9464fa683d46a499964f555a7f6f8c7cd282',
			platformProfile: 'modern-x86',
			cloudInit: {adminGroup: 'sudo', commands: [['bash', '-c', DEBIAN_DESKTOP_INSTALL]], graphical: true},
		},
		{
			id: 'debian-13-server-amd64',
			familyId: 'debian',
			name: 'Debian',
			variantName: 'Server',
			version: 'Debian 13',
			sizeMb: 437,
			arch: 'amd64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://cloud.debian.org/images/cloud/trixie/20260706-2531/debian-13-generic-amd64-20260706-2531.qcow2',
			sha256: '7568c141e73c83eca7882625fafb9464fa683d46a499964f555a7f6f8c7cd282',
			platformProfile: 'modern-x86',
			cloudInit: {adminGroup: 'sudo'},
		},
		{
			id: 'debian-13-desktop-arm64',
			familyId: 'debian',
			name: 'Debian',
			variantName: 'Desktop',
			version: 'Debian 13',
			sizeMb: 429,
			estimatedInstalledSizeMb: 6_100,
			arch: 'arm64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://cloud.debian.org/images/cloud/trixie/20260706-2531/debian-13-generic-arm64-20260706-2531.qcow2',
			sha256: 'b8a05fc7c18deff0aa213ddbdc883ccfaeeee1478f12d608e9da97a7aaaac5f9',
			platformProfile: 'modern-arm64',
			cloudInit: {adminGroup: 'sudo', commands: [['bash', '-c', DEBIAN_DESKTOP_INSTALL]], graphical: true},
		},
		{
			id: 'debian-13-server-arm64',
			familyId: 'debian',
			name: 'Debian',
			variantName: 'Server',
			version: 'Debian 13',
			sizeMb: 429,
			arch: 'arm64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://cloud.debian.org/images/cloud/trixie/20260706-2531/debian-13-generic-arm64-20260706-2531.qcow2',
			sha256: 'b8a05fc7c18deff0aa213ddbdc883ccfaeeee1478f12d608e9da97a7aaaac5f9',
			platformProfile: 'modern-arm64',
			cloudInit: {adminGroup: 'sudo'},
		},
		{
			id: 'alpine-3.24.1-amd64',
			familyId: 'alpine',
			name: 'Alpine Linux',
			version: 'Alpine Linux 3.24.1',
			sizeMb: 202,
			arch: 'amd64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/cloud/generic_alpine-3.24.1-x86_64-uefi-cloudinit-r0.qcow2',
			sha256: '20acb6673d31497bc292a8f6a075d98aa47d03cfe79ddf3c811840e60cf6f8c5',
			platformProfile: 'modern-x86',
			cloudInit: {shell: '/bin/ash', adminGroup: 'wheel', packages: ['sudo']},
		},
		{
			id: 'alpine-3.24.1-arm64',
			familyId: 'alpine',
			name: 'Alpine Linux',
			version: 'Alpine Linux 3.24.1',
			sizeMb: 239,
			arch: 'arm64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/cloud/generic_alpine-3.24.1-aarch64-uefi-cloudinit-r0.qcow2',
			sha256: '3059a6280977c2122982632e0317c5ddbd39069d46ca1e60480de283091f720f',
			platformProfile: 'modern-arm64',
			cloudInit: {shell: '/bin/ash', adminGroup: 'wheel', packages: ['sudo']},
		},
		{
			id: 'android-13-amd64',
			familyId: 'android',
			name: 'Android',
			version: 'Android 13 · Waydroid',
			sizeMb: 859,
			arch: 'amd64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://cloud-images.ubuntu.com/releases/resolute/release-20260627/ubuntu-26.04-server-cloudimg-amd64.img',
			sha256: '3ee4f67f322abb2d1d1f0fffc957f7411404ad6635dd35b026c8ff05ac6e534c',
			diskFormat: 'qcow2',
			platformProfile: 'modern-x86',
			cloudInit: {adminGroup: 'sudo', commands: [['bash', '-c', ANDROID_INSTALL]], graphical: true},
		},
		{
			id: 'android-13-arm64',
			familyId: 'android',
			name: 'Android',
			version: 'Android 13 · Waydroid',
			sizeMb: 940,
			arch: 'arm64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://cloud-images.ubuntu.com/releases/resolute/release-20260627/ubuntu-26.04-server-cloudimg-arm64.img',
			sha256: '3d8db37fa9a8a0c8676dfc0ee3eb41fd0049d66cb055a792bddc8f4123443ae1',
			diskFormat: 'qcow2',
			platformProfile: 'modern-arm64',
			cloudInit: {adminGroup: 'sudo', commands: [['bash', '-c', ANDROID_INSTALL]], graphical: true},
		},
		{
			id: 'omarchy-4.0.4-amd64',
			familyId: 'omarchy',
			name: 'Omarchy',
			version: 'Omarchy 4.0.4',
			sizeMb: 6_186,
			estimatedInstalledSizeMb: 6_800,
			arch: 'amd64',
			platform: 'linux',
			requiresCredentials: true,
			url: 'https://iso.omarchy.org/omarchy-4.0.4.iso',
			sha256: 'ddeded2758c48318d201dfdac905ecb28f570441883f0c052ea3cd5d05acf92d',
			platformProfile: 'modern-x86',
		},
		// Mirrors are checksum-pinned so media cannot change underneath an
		// install. Legacy XP/98 media requires a user-supplied product key.
		{
			id: 'windows-11-25h2-amd64',
			familyId: 'windows-11',
			name: 'Windows 11',
			version: 'Windows 11 25H2',
			sizeMb: 8_472,
			arch: 'amd64',
			platform: 'windows',
			requiresCredentials: true,
			url: 'https://archive.org/download/windows_11_25h2_english_x64_official_ms_backup/Win11_25H2_English_x64_Official.iso',
			sha256: '768984706b909479417b2368438909440f2967ff05c6a9195ed2667254e465e3',
			platformProfile: 'modern-x86',
			windows: {installer: 'windows-11'},
			resources: [
				{
					id: 'virtio-win-0.1.285',
					url: 'https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/archive-virtio/virtio-win-0.1.285-1/virtio-win-0.1.285.iso',
					sha256: 'e14cf2b94492c3e925f0070ba7fdfedeb2048c91eea9c5a5afb30232a3976331',
					fileName: 'virtio-win.iso',
				},
			],
		},
		{
			id: 'windows-11-25h2-arm64',
			familyId: 'windows-11',
			name: 'Windows 11',
			version: 'Windows 11 25H2',
			sizeMb: 7_300,
			arch: 'arm64',
			platform: 'windows',
			requiresCredentials: true,
			url: 'https://archive.org/download/win11-25h2-english-arm64/Win11_25H2_English_Arm64.iso',
			sha256: '32cde0071ed8086b29bb6c8c3bf17ba9e3cdf43200537434a811a9b6cc2711a1',
			platformProfile: 'modern-arm64',
			windows: {installer: 'windows-11'},
			resources: [
				{
					id: 'virtio-win-0.1.285',
					url: 'https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/archive-virtio/virtio-win-0.1.285-1/virtio-win-0.1.285.iso',
					sha256: 'e14cf2b94492c3e925f0070ba7fdfedeb2048c91eea9c5a5afb30232a3976331',
					fileName: 'virtio-win.iso',
				},
			],
		},
		{
			id: 'windows-server-2025-amd64',
			familyId: 'windows-server',
			name: 'Windows Server',
			variantName: 'Desktop Experience',
			version: '2025 Evaluation',
			sizeMb: 5_308,
			arch: 'amd64',
			platform: 'windows',
			requiresCredentials: true,
			evaluation: true,
			url: 'https://archive.org/download/26100.1.240331-1435.ge-release-server-eval-x-64-fre-en-us/26100.1.240331-1435.ge_release_SERVER_EVAL_x64FRE_en-us.iso',
			sha256: '16442d1c0509bcbb25b715b1b322a15fb3ab724a42da0f384b9406ca1c124ed4',
			platformProfile: 'modern-x86',
			windows: {installer: 'windows-server-2025'},
			resources: [
				{
					id: 'virtio-win-0.1.285',
					url: 'https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/archive-virtio/virtio-win-0.1.285-1/virtio-win-0.1.285.iso',
					sha256: 'e14cf2b94492c3e925f0070ba7fdfedeb2048c91eea9c5a5afb30232a3976331',
					fileName: 'virtio-win.iso',
				},
			],
		},
		{
			id: 'windows-7-enterprise-amd64',
			familyId: 'windows-7',
			name: 'Windows 7',
			version: 'Enterprise SP1',
			sizeMb: 3_183,
			arch: 'amd64',
			platform: 'windows',
			requiresCredentials: true,
			url: 'https://archive.org/download/windows-7-enterprise-x64/en_windows_7_enterprise_with_sp1_x64_dvd_u_677651.iso',
			sha256: 'ee69f3e9b86ff973f632db8e01700c5724ef78420b175d25bae6ead90f6805a7',
			platformProfile: 'windows-7-x86',
			windows: {installer: 'windows-7'},
		},
		{
			id: 'windows-xp-professional-amd64',
			familyId: 'windows-xp',
			name: 'Windows XP',
			version: 'Professional SP3',
			sizeMb: 621,
			arch: 'amd64',
			platform: 'windows',
			requiresCredentials: true,
			url: 'https://archive.org/download/win_xp_pro_sp3_x86_205076/Windows%20XP%20Professional%20SP3%20x86.iso',
			sha256: '0d224d350f58a80e3112934cf2ec6c4b9aa5a8c308179ef9d1dbb898a1e85b9a',
			platformProfile: 'legacy-x86',
			// SETUPP.INI Pid=76487270 on a GRTMPVOL_EN disc
			licenseChannel: 'volume',
			windows: {installer: 'windows-xp'},
		},
		{
			id: 'windows-98-se-amd64',
			familyId: 'windows-98',
			name: 'Windows 98',
			version: 'Second Edition',
			sizeMb: 656,
			arch: 'amd64',
			platform: 'windows',
			manualSetup: true,
			requiresCredentials: true,
			url: 'https://archive.org/download/windows-98-second-edition_202407/Windows%2098%20Second%20Edition.iso',
			sha256: '2adfb46df8a9c7bbd2f67bff07461cc2f9d9ec8e01f0e112cb044c9e3e62f607',
			platformProfile: 'windows-98-x86',
			fixedMemoryMb: 512,
			// OEM full install: setuppp.inf ProductType=9 and the OEM license.txt
			licenseChannel: 'oem',
			windows: {installer: 'windows-98'},
			resources: [
				{
					id: 'windows-98-se-usb-boot',
					url: 'https://archive.org/download/windows-98-second-edition-usb-boot-disk/Windows%2098%20Second%20Edition%20USB%20Boot%20Disk.img',
					sha256: '3c0bd269c0b24cd4d9928ccff32daf5f0f822fee2428ade6283eba73efef47cd',
					fileName: 'windows-98-boot.img',
				},
				{
					id: 'patcher9x-0.9.91',
					url: 'https://github.com/JHRobotics/patcher9x/releases/download/v0.9.91/patcher9x-0.9.91-linux-amd64.tar.gz',
					sha256: 'ca787d7c6421959c9f37afdd998feb9393fe07c1c63c43c4e22db5b170a79908',
					fileName: 'patcher9x.tar.gz',
				},
			],
		},
	],
})

const storedImageSchema = z.object({
	id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/i),
	familyId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/i),
	name: z.string().min(1).max(200),
	variantName: z.string().max(200).optional(),
	version: z.string().max(200),
	sizeMb: z.number().nonnegative(),
	arch: z.enum(['amd64', 'arm64']),
	platform: z.enum(['linux', 'windows']).optional(),
	requiresCredentials: z.boolean(),
	custom: z.boolean().optional(),
	state: z.enum(['available', 'downloading', 'downloaded', 'failed']),
	downloadProgress: z.number().optional(),
	downloadedMb: z.number().optional(),
	errorMessage: z.string().optional(),
	sourceUrl: z.string().url().optional(),
	sha256: z
		.string()
		.regex(/^[0-9a-f]{64}$/i)
		.optional(),
	fileName: z
		.string()
		.regex(/^image\.(iso|qcow2|img|vmdk|vdi|vhdx|vhd)$/i)
		.optional(),
	platformProfile: z.enum(['modern-x86', 'windows-7-x86', 'legacy-x86', 'windows-98-x86', 'modern-arm64']).optional(),
	fixedMemoryMb: z.number().int().min(128).max(1_048_576).optional(),
})

// Custom disks are intentionally limited to raw images. Supporting structured
// formats is straightforward with qemu-img, but user-controlled images must be
// converted in a sandbox that cannot follow backing files, data files, extents,
// parent locators, or other references into the host filesystem.
const CUSTOM_IMAGE_EXTENSIONS = /\.(iso|img)$/i
const CATALOG_IMAGE_EXTENSIONS = /\.(iso|qcow2|img|vmdk|vdi|vhdx|vhd)$/i
// Reserved from ephemeral port assignment in packages/os/overlay/etc/sysctl.d/99-umbrel-machines-ports.conf
const MACHINES_PORT_MIN = 40_000
const MACHINES_PORT_MAX = 49_999

function randomMacAddress() {
	const bytes = randomBytes(6)
	bytes[0] = (bytes[0] & 0b11111100) | 0b00000010
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(':')
}

function slugifyHostname(value: string) {
	return slugifyMachineId(value)
}

export function renderCloudInitUserData(
	username: string,
	passwordHash: string,
	provisioning: CloudInitProvisioning = {},
	completionUrl?: string,
) {
	const cloudConfig: Record<string, unknown> = {
		users: [
			{
				name: username,
				shell: provisioning.shell ?? '/bin/bash',
				lock_passwd: false,
				passwd: passwordHash,
				sudo: 'ALL=(ALL) NOPASSWD:ALL',
				...(provisioning.adminGroup && {groups: [provisioning.adminGroup]}),
			},
		],
		ssh_pwauth: true,
		chpasswd: {expire: false},
	}

	if (provisioning.packages?.length) {
		cloudConfig.package_update = true
		cloudConfig.packages = provisioning.packages
	}

	const commands = [...(provisioning.commands ?? [])]
	if (provisioning.graphical) commands.push(['systemctl', 'set-default', 'graphical.target'])
	if (commands.length) cloudConfig.runcmd = commands

	if (completionUrl) {
		cloudConfig.phone_home = {
			url: completionUrl,
			post: ['instance_id'],
			tries: 60,
		}
	}

	if (provisioning.graphical) {
		cloudConfig.power_state = {
			delay: 'now',
			mode: 'reboot',
			message: 'Rebooting after machine setup',
			condition: true,
		}
	}

	return `#cloud-config\n${yaml.dump(cloudConfig, {noRefs: true, lineWidth: 120})}`
}

export function firstBootSetupTimeoutMs(definition: Pick<MachineDefinition, 'osId' | 'arch'>) {
	return definition.osId === 'windows-11' && definition.arch === 'arm64'
		? WINDOWS_ARM_FIRST_BOOT_SETUP_TIMEOUT_MS
		: FIRST_BOOT_SETUP_TIMEOUT_MS
}

export function isFirstBootSetupActive(
	setup: MachineDefinition['firstBootSetup'],
	now = Date.now(),
	timeout = FIRST_BOOT_SETUP_TIMEOUT_MS,
): boolean {
	return !!setup && !setup.manual && now - setup.startedAt < timeout
}

// A bridged machine whose setup never called home still joins the LAN once
// Umbrel has stopped waiting for it, rather than staying on NAT for good
export function machineJoinsLanNow(definition: MachineDefinition, now = Date.now()) {
	const setupExpired =
		!!definition.firstBootSetup && now - definition.firstBootSetup.startedAt >= firstBootSetupTimeoutMs(definition)
	return machineJoinsLan(definition, {setupExpired})
}

export function firstBootTokenMatches(token: string, expectedHash: string) {
	if (!/^[0-9a-f]{64}$/.test(token)) return false
	const actual = Buffer.from(createHash('sha256').update(token).digest('hex'))
	const expected = Buffer.from(expectedHash)
	return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export default class Machines {
	#umbreld: Umbreld
	#store: MachineStore
	#libvirt: Libvirt
	#operations = new Map<string, MachineState>()
	#errors = new Map<string, string>()
	#lastStates = new Map<string, MachineState>()
	#lastFirstBootSetupStates = new Map<string, boolean>()
	#pollTimer?: NodeJS.Timeout
	#polling = false
	#omarchySetupProbes = new Map<string, Promise<void>>()
	#libvirtActivated = false
	#libvirtActivation?: Promise<void>
	#nextLibvirtProbeAt = 0
	#osImages: InternalOsImage[]
	#imageDownloads = new Map<string, ImageDownloadJob>()
	#imageDownloadQueue = new PQueue({concurrency: 1})
	#createQueue = new PQueue({concurrency: 1})
	#machineLockTails = new Map<string, Promise<void>>()
	#externalStorageBlocks = new Map<symbol, string[]>()
	#installJobs = new Map<string, MachineInstallJob>()
	#installCredentials = new Map<string, MachineInstallCredentials>()
	#installProgress = new Map<string, number>()
	#installationStates = new Map<string, Extract<MachineInstallationState, 'preparing' | 'starting'>>()
	#backupMachines = new Set<string>()
	#backupActive = false
	#guestApi: MachineGuestApi
	#lanBridge: LanBridge
	#lanBridgeRelease?: Promise<void>
	#imagesDirectory: string
	#runtimeUsageCache?: {expiresAt: number; value: {cpu: MachineResourceUsage[]; memory: MachineResourceUsage[]}}
	#runtimeUsageInFlight?: Promise<{cpu: MachineResourceUsage[]; memory: MachineResourceUsage[]}>
	#previousCpuSample?: {at: bigint; times: Map<string, number>}
	logger: Umbreld['logger']

	// Agent control bookkeeping is memory-only: it describes what is happening
	// at the console right now, not anything worth keeping across restarts
	#agentControls = new Map<string, MachineAgentControl>()
	#agentControlTimers = new Map<string, NodeJS.Timeout>()
	#agentPointers = new Map<string, PointerTarget>()
	// Guests whose first press after boot has already been spent
	#primedMachines = new Set<string>()
	#inputQueues = new Map<string, PQueue>()
	#activeInputs = new Set<string>()
	#inputSequence = 0
	#usbTopology?: string
	#usbReconcileQueue = new PQueue({concurrency: 1})
	// When to look again at assigned devices the host was using
	#usbRetryAt?: number
	// What was last logged about each machine's devices, so retries stay quiet
	#usbNotices = new Map<string, Set<string>>()
	// The devices each running machine was last given and where they were
	// plugged in, so one that disconnects and comes back as a different model
	// can be followed
	#usbAttached = new Map<string, Array<{address: UsbAddress; port: string; assignment: UsbDeviceAssignment}>>()
	// Devices running machines lost recently, and when
	#usbDeparted = new Map<string, Array<{port: string; assignment: UsbDeviceAssignment; at: number}>>()
	// The udev rules last written and the plugged in devices they covered
	#usbReservation?: {rules: string; paths: string[]}

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		this.logger = umbreld.logger.createChildLogger('machines')
		this.#store = new MachineStore(umbreld.dataDirectory)
		this.#libvirt = new Libvirt(umbreld)
		this.#lanBridge = new LanBridge(umbreld)
		this.#guestApi = new MachineGuestApi({
			host: MACHINE_GUEST_HOST_ADDRESS,
			port: umbreld.port,
			completeFirstBootSetup: (id, token) => this.completeFirstBootSetup(id, token),
			logger: this.logger,
		})
		this.#imagesDirectory = nodePath.join(umbreld.dataDirectory, 'machine-images')
		this.#osImages = builtinMachinesCatalog.images
			.filter((image) => image.arch === hostArchitecture())
			.map(({url, ...image}) => ({...image, sourceUrl: url, state: 'available' as const}))
	}

	async start() {
		await Promise.all([this.#store.start(), fse.ensureDir(this.#imagesDirectory)])
		await this.#loadDownloadedImages()
		await this.#ensureIpAddresses()
		this.#emitOsImages()
		await this.#activateLibvirt()
		this.#pollTimer = setInterval(
			() => void this.#poll().catch((error) => this.logger.error('Failed polling machine state', error)),
			1_000,
		)
		this.logger.log(
			`Machines ready (${this.#libvirt.available ? 'libvirt' : 'virtualization unavailable'}, ${this.#libvirt.kvmAvailable ? 'KVM' : 'TCG fallback'})`,
		)
	}

	async #activateLibvirt() {
		if (this.#libvirtActivated || this.#libvirtActivation) return this.#libvirtActivation
		this.#libvirtActivation = (async () => {
			try {
				await this.#libvirt.probe()
				if (!this.#libvirt.available) return
				await this.#recoverInterruptedBackups()
				await this.#libvirt.reconcileNetwork(await this.#store.list())
				await this.#guestApi.start()
				this.#libvirtActivated = true
				for (const definition of await this.#store.list()) {
					if (!definition.autostart) continue
					void this.startMachine(definition.id).catch((error) =>
						this.logger.error(`Failed to autostart machine ${definition.id}`, error),
					)
				}
			} catch (error) {
				// libvirt and the LAN route can become ready after umbreld. Keep the
				// module available to the rest of the OS and let the poller retry the
				// whole transient reconstruction instead of failing umbreld startup.
				this.#libvirtActivated = false
				this.logger.error('Failed activating Machines; will retry', error)
			} finally {
				if (!this.#libvirtActivated) this.#nextLibvirtProbeAt = Date.now() + 10_000
			}
		})()
		try {
			await this.#libvirtActivation
		} finally {
			this.#libvirtActivation = undefined
		}
	}

	async stop() {
		if (this.#pollTimer) clearInterval(this.#pollTimer)
		this.#pollTimer = undefined
		this.#usbReconcileQueue.clear()
		await this.#usbReconcileQueue.onIdle()
		await Promise.allSettled(this.#omarchySetupProbes.values())
		for (const job of this.#installJobs.values()) job.controller.abort(new Error('[machine-install-cancelled]'))
		await Promise.allSettled([...this.#installJobs.values()].map(({promise}) => promise))
		for (const job of this.#imageDownloads.values())
			job.controller.abort(new Error('[machine-image-download-cancelled]'))
		await Promise.allSettled([...this.#imageDownloads.values()].map(({promise}) => promise))
		this.#installJobs.clear()
		this.#imageDownloads.clear()
		await this.#guestApi.stop()

		if (!this.#libvirt.available) return
		// Domains are deliberately transient and reconstructed from the Umbrel
		// data directory. Ask all guests to shut down in parallel, then enforce a
		// short upper bound so a guest that ignores ACPI cannot hold up an Umbrel
		// reboot indefinitely.
		await Promise.all(
			(await this.#store.list()).map(async ({id}) => {
				try {
					await this.#libvirt.stop(id, {timeout: 10_000})
				} catch (error) {
					this.logger.error(`Machine ${id} did not shut down gracefully; forcing it off`, error)
					await this.#libvirt.stop(id, {force: true})
				}
			}),
		)
		await this.#libvirt.cleanupNetwork()
	}

	async capabilities() {
		await this.#activateLibvirt()
		return {
			hostArchitecture: hostArchitecture(),
			libvirtAvailable: this.#libvirt.available,
			kvmAvailable: this.#libvirt.kvmAvailable,
			nativeAcceleration: this.#libvirt.kvmAvailable ? ('kvm' as const) : ('tcg' as const),
			performanceWarning: this.#libvirt.kvmAvailable
				? undefined
				: 'Hardware virtualization is unavailable. Machines will use software emulation and run significantly slower.',
			portRange: {start: MACHINES_PORT_MIN, end: MACHINES_PORT_MAX},
			guestHostAddress: MACHINE_GUEST_HOST_ADDRESS,
			// Whether machines can join the LAN directly, and if not, why not
			lanBridge: await this.#lanBridge.availability().catch((error) => {
				this.logger.error('Failed to check whether machines can join the LAN', error)
				return {available: false as const, reason: 'no-ethernet' as const}
			}),
		}
	}

	async #poll() {
		if (this.#polling) return
		this.#polling = true
		try {
			if (!this.#libvirtActivated && Date.now() >= this.#nextLibvirtProbeAt) await this.#activateLibvirt()
			const definitions = await this.#store.list()
			if (this.#libvirtActivated) await this.#libvirt.ensureFirewall(definitions)
			await this.#releaseLanBridge(definitions)
			// Pass replugged devices back to their machines and drop ones that went away
			if (this.#libvirtActivated) {
				const usbTopology = await usbTopologyFingerprint()
				// The host may have let go of a device it was using, like an app that
				// was stopped
				const retry = this.#usbRetryAt !== undefined && Date.now() >= this.#usbRetryAt
				if (usbTopology !== this.#usbTopology || retry) {
					this.#usbTopology = usbTopology
					this.#usbRetryAt = undefined
					this.#requestUsbReconcile()
				}
			}
			const states = await Promise.all(
				definitions.map(async (definition) => {
					const state = await this.#state(definition)
					if (
						this.#pollTimer &&
						definition.osId === 'omarchy' &&
						definition.firstBootSetup &&
						state === 'running' &&
						!this.#omarchySetupProbes.has(definition.id)
					) {
						// A guest's SSH timeout must not delay state updates for other machines.
						const probe = probeOmarchySetup(
							this.#store.directory(definition.id),
							definition.username!,
							definition.ipAddress!,
						)
							.catch((error) => this.logger.error(`Failed probing Omarchy setup for ${definition.id}`, error))
							.finally(() => this.#omarchySetupProbes.delete(definition.id))
						this.#omarchySetupProbes.set(definition.id, probe)
					}
					return {
						id: definition.id,
						state,
						firstBootSetup: isFirstBootSetupActive(
							definition.firstBootSetup,
							Date.now(),
							firstBootSetupTimeoutMs(definition),
						),
					}
				}),
			)
			let changed = states.length !== this.#lastStates.size
			for (const machine of states) {
				if (this.#lastStates.get(machine.id) !== machine.state) {
					changed = true
					// A guest that stopped on its own boots afresh next time
					if (machine.state !== 'running') this.#forgetMachineInput(machine.id)
					// Catch up on devices plugged in while it was starting or paused
					else this.#requestUsbReconcile()
					// Its next start reports what it can't have afresh
					if (machine.state === 'stopped') this.#forgetUsbDevices(machine.id)
				}
				if (this.#lastFirstBootSetupStates.get(machine.id) !== machine.firstBootSetup) changed = true
				this.#lastStates.set(machine.id, machine.state)
				this.#lastFirstBootSetupStates.set(machine.id, machine.firstBootSetup)
			}
			for (const id of this.#lastStates.keys()) {
				if (states.some((machine) => machine.id === id)) continue
				this.#lastStates.delete(id)
				this.#lastFirstBootSetupStates.delete(id)
			}
			if (changed) await this.#emitMachines()
		} finally {
			this.#polling = false
		}
	}

	async #acquireMachineLock(id: string) {
		const previous = this.#machineLockTails.get(id) ?? Promise.resolve()
		let releaseGate!: () => void
		const gate = new Promise<void>((resolve) => (releaseGate = resolve))
		const tail = previous.catch(() => {}).then(() => gate)
		this.#machineLockTails.set(id, tail)
		await previous.catch(() => {})

		let released = false
		return () => {
			if (released) return
			released = true
			releaseGate()
			if (this.#machineLockTails.get(id) === tail) this.#machineLockTails.delete(id)
		}
	}

	async #withMachineLock<T>(id: string, operation: () => Promise<T>) {
		const release = await this.#acquireMachineLock(id)
		try {
			return await operation()
		} finally {
			release()
		}
	}

	async #emitMachines(machines?: Machine[]) {
		this.#umbreld.eventBus.emit('machines:updated', machines ?? (await this.list()))
	}

	#emitOsImages() {
		this.#umbreld.eventBus.emit('machines:os-images-updated', this.#publicOsImages())
	}

	#publicOsImages() {
		return this.#osImages.map(
			({
				sourceUrl: _sourceUrl,
				sha256: _sha256,
				fileName: _fileName,
				diskFormat: _diskFormat,
				platformProfile: _platformProfile,
				cloudInit: _cloudInit,
				windows,
				resources: _resources,
				...image
			}) => ({
				...image,
				requiresLicenseKey: windows?.installer === 'windows-xp' || windows?.installer === 'windows-98' || undefined,
			}),
		)
	}

	async #loadDownloadedImages() {
		const entries = await fsp.readdir(this.#imagesDirectory, {withFileTypes: true}).catch(() => [])
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith('.')) continue
			try {
				const metadataPath = nodePath.join(this.#imagesDirectory, entry.name, 'image.yaml')
				const image = storedImageSchema.parse(yaml.load(await fsp.readFile(metadataPath, 'utf8')))
				if (image.state === 'downloading') {
					image.state = 'failed'
					image.errorMessage = 'The previous download was interrupted.'
				}
				const existing = this.#osImages.find((item) => item.id === image.id)
				if (existing) {
					// The shipped catalog owns identity, labels, architecture and
					// provisioning. Persisted metadata only restores mutable cache state.
					existing.state = image.state
					existing.sizeMb = image.sizeMb
					existing.fileName = image.fileName
					existing.downloadProgress = image.downloadProgress
					existing.downloadedMb = image.downloadedMb
					existing.errorMessage = image.errorMessage
				} else {
					// Retired built-in downloads are caches, not machine data. Keep the
					// files intact for now but do not reintroduce obsolete catalog choices.
					this.logger.log(`Ignoring retired machine image ${image.id}`)
				}
			} catch (error) {
				this.logger.error(`Ignoring invalid machine image metadata in ${entry.name}`, error)
			}
		}
	}

	#imageDirectory(id: string) {
		return nodePath.join(this.#imagesDirectory, id)
	}

	#resourcePath(resource: ImageResource) {
		return nodePath.join(this.#imagesDirectory, '.resources', resource.sha256, resource.fileName)
	}

	async #resourceIsValid(resource: ImageResource) {
		const path = this.#resourcePath(resource)
		if (!(await fse.pathExists(path))) return false
		const hash = createHash('sha256')
		for await (const chunk of fse.createReadStream(path)) hash.update(chunk)
		return hash.digest('hex') === resource.sha256.toLowerCase()
	}

	async #downloadResources(resources: ImageResource[], signal: AbortSignal) {
		for (const resource of resources) {
			if (await this.#resourceIsValid(resource)) continue
			await safeDownload({
				url: resource.url,
				destination: this.#resourcePath(resource),
				expectedSha256: resource.sha256,
				signal,
			})
		}
	}

	#updateDownloadProgress(image: InternalOsImage, job: ImageDownloadJob, downloadedBytes: number, percent?: number) {
		// Progress can arrive while a previous interrupted state is still visible
		// to subscribers. The active transfer is authoritative.
		image.state = 'downloading'
		delete image.errorMessage
		image.downloadedMb = Math.round(downloadedBytes / 1_000_000)
		image.downloadProgress = Math.round((percent ?? 0) * 10) / 10
		for (const consumer of job.consumers) {
			if (consumer.startsWith('machine:'))
				this.#installProgress.set(consumer.slice('machine:'.length), (percent ?? 0) * 0.7)
		}
		this.#emitOsImages()
		void this.#emitMachines().catch((error) => this.logger.error('Failed emitting machine install progress', error))
	}

	async #startImageDownload(image: InternalOsImage): Promise<ImageDownloadJob> {
		const existing = this.#imageDownloads.get(image.id)
		if (existing && !existing.controller.signal.aborted) return existing
		if (existing) {
			// A job whose last consumer just left is still cleaning up. Joining it
			// would fail this consumer, so let it settle (which removes it) and look
			// again, joining a fresh download another consumer may have started.
			await existing.promise.catch(() => {})
			return this.#startImageDownload(image)
		}
		if (!image.sourceUrl) throw new Error('[os-image-source-unavailable]')

		const extension = nodePath.extname(new URL(image.sourceUrl).pathname).toLowerCase()
		if (!CATALOG_IMAGE_EXTENSIONS.test(extension)) throw new Error('[machine-image-invalid]')
		image.fileName = `image${extension}`
		image.state = 'downloading'
		image.downloadProgress = 0
		delete image.downloadedMb
		delete image.errorMessage
		await this.#saveImage(image)
		this.#emitOsImages()

		const controller = new AbortController()
		let job!: ImageDownloadJob
		const promise = (async () => {
			try {
				const {size, sha256} = await safeDownload({
					url: image.sourceUrl!,
					destination: nodePath.join(this.#imageDirectory(image.id), image.fileName!),
					expectedSha256: image.sha256,
					signal: controller.signal,
					onProgress: ({downloadedBytes, percent}) =>
						this.#updateDownloadProgress(image, job, downloadedBytes, percent),
				})
				await this.#downloadResources(image.resources ?? [], controller.signal)
				image.state = 'downloaded'
				image.sizeMb = Math.round(size / 1_000_000)
				image.sha256 = sha256
				delete image.downloadProgress
				delete image.downloadedMb
				delete image.errorMessage
				await this.#saveImage(image)
			} catch (error) {
				if (controller.signal.aborted) {
					image.state = 'available'
					delete image.downloadProgress
					delete image.downloadedMb
					delete image.errorMessage
					await this.#saveImage(image)
					throw controller.signal.reason ?? error
				}
				image.state = 'failed'
				image.errorMessage = error instanceof Error ? error.message : String(error)
				delete image.downloadProgress
				delete image.downloadedMb
				await this.#saveImage(image)
				throw error
			} finally {
				if (this.#imageDownloads.get(image.id) === job) this.#imageDownloads.delete(image.id)
				this.#emitOsImages()
			}
		})()
		// A consumer can already be aborted when it registers with this job. In
		// that case it releases the final consumer before awaiting the promise,
		// which aborts the download. Keep the shared job rejection observed from
		// creation while still exposing the original promise to active consumers.
		void promise.catch(() => {})
		job = {controller, consumers: new Set(), promise}
		this.#imageDownloads.set(image.id, job)
		return job
	}

	#releaseImageDownload(imageId: string, consumer: string) {
		const job = this.#imageDownloads.get(imageId)
		if (!job) return
		job.consumers.delete(consumer)
		if (job.consumers.size === 0 && this.#imageDownloads.get(imageId) === job && !job.controller.signal.aborted) {
			job.controller.abort(new Error('[machine-image-download-cancelled]'))
		}
	}

	async #ensureImageDownloaded(image: InternalOsImage, consumer: string, signal: AbortSignal) {
		if (image.state === 'downloaded' && image.fileName) {
			await this.#downloadResources(image.resources ?? [], signal)
			if (consumer.startsWith('machine:')) this.#installProgress.set(consumer.slice('machine:'.length), 70)
			return
		}

		const job = await this.#imageDownloadQueue.add(() => this.#startImageDownload(image))
		if (!job) throw new Error('[machine-image-download-failed]')
		job.consumers.add(consumer)
		if (consumer.startsWith('machine:')) {
			this.#installProgress.set(consumer.slice('machine:'.length), (image.downloadProgress ?? 0) * 0.7)
		}
		if (signal.aborted) {
			this.#releaseImageDownload(image.id, consumer)
			throw signal.reason
		}

		await new Promise<void>((resolve, reject) => {
			const onAbort = () => reject(signal.reason)
			signal.addEventListener('abort', onAbort, {once: true})
			job.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
		}).finally(() => this.#releaseImageDownload(image.id, consumer))
	}

	async #saveImage(image: InternalOsImage) {
		const directory = this.#imageDirectory(image.id)
		await fse.ensureDir(directory)
		const path = nodePath.join(directory, 'image.yaml')
		const temporary = `${path}.${process.pid}.tmp`
		await fsp.writeFile(temporary, yaml.dump(image, {noRefs: true}), {encoding: 'utf8', mode: 0o600})
		await fsp.rename(temporary, path)
	}

	#getOsImage(id: string) {
		const image = this.#osImages.find((item) => item.id === id)
		if (!image) throw new Error('[os-image-not-found]')
		return image
	}

	listOsImages() {
		return this.#publicOsImages()
	}

	async #definition(id: string) {
		try {
			return await this.#store.read(id)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('[machine-not-found]')
			throw error
		}
	}

	async #diskSystemPath(definition: MachineDefinition) {
		if (!definition.diskPath) return nodePath.join(this.#store.directory(definition.id), 'disk.qcow2')
		return this.#umbreld.files.virtualToSystemPath(definition.diskPath, OWNER_USER_ID)
	}

	#storagePathIsWithin(path: string, roots: string[]) {
		const normalized = nodePath.posix.normalize(path)
		return roots.some((root) => normalized === root || normalized.startsWith(`${root}/`))
	}

	#assertExternalStorageNotBlocked(definition: MachineDefinition) {
		if (!definition.diskPath) return
		for (const roots of this.#externalStorageBlocks.values()) {
			if (this.#storagePathIsWithin(definition.diskPath, roots)) {
				throw new Error('[machine-external-disk-in-use]')
			}
		}
	}

	// Hold the lifecycle locks for every machine backed by these Files mount
	// paths while a drive/share is detached. Starts queued after the block either
	// wait for a successful detach and observe the missing disk, or fail while the
	// block is active; an in-flight start/install makes the detach fail safely.
	async blockStoragePaths(paths: string[]) {
		const roots = paths.map((path) => nodePath.posix.normalize(path))
		const token = Symbol('machine-external-storage-block')
		const releases: Array<() => void> = []
		const locked = new Set<string>()
		this.#externalStorageBlocks.set(token, roots)

		try {
			for (;;) {
				const ids = (await this.#store.list())
					.filter(
						(definition) =>
							definition.diskPath &&
							this.#storagePathIsWithin(definition.diskPath, roots) &&
							!locked.has(definition.id),
					)
					.map(({id}) => id)
					.sort()
				if (ids.length === 0) break
				for (const id of ids) {
					releases.push(await this.#acquireMachineLock(id))
					locked.add(id)
				}
			}

			for (const definition of await this.#store.list()) {
				if (!definition.diskPath || !this.#storagePathIsWithin(definition.diskPath, roots)) continue
				if (this.#installJobs.has(definition.id) || (await this.#libvirt.state(definition.id)) !== 'stopped') {
					throw new Error(`[machine-external-disk-in-use] ${definition.name}`)
				}
			}

			let released = false
			return () => {
				if (released) return
				released = true
				for (const release of releases.reverse()) release()
				this.#externalStorageBlocks.delete(token)
			}
		} catch (error) {
			for (const release of releases.reverse()) release()
			this.#externalStorageBlocks.delete(token)
			throw error
		}
	}

	async #externalDiskAvailable(definition: MachineDefinition) {
		if (!definition.diskPath || definition.installSource) return true
		try {
			return (await fse.stat(await this.#diskSystemPath(definition))).isFile()
		} catch {
			return false
		}
	}

	async #state(definition: MachineDefinition): Promise<MachineState> {
		const operation = this.#operations.get(definition.id)
		const domainState = this.#libvirt.available ? await this.#libvirt.state(definition.id) : 'stopped'
		return (
			operation ??
			(this.#errors.has(definition.id) || definition.installSource
				? 'error'
				: domainState === 'running'
					? 'running'
					: domainState === 'suspended'
						? 'suspended'
						: 'stopped')
		)
	}

	async #view(definition: MachineDefinition): Promise<Machine> {
		const acceleration = resolveAcceleration(definition.arch, this.#libvirt.kvmAvailable)
		const {firstBootSetup, installSource, installMedia, seedMedia, bootMedia, ...publicDefinition} = definition
		const externalDiskAvailable = await this.#externalDiskAvailable(definition)
		const state = externalDiskAvailable ? await this.#state(definition) : 'error'
		const firstBootSetupActive = isFirstBootSetupActive(firstBootSetup, Date.now(), firstBootSetupTimeoutMs(definition))
		const firstBootSetupPending = !!firstBootSetup && !firstBootSetup.manual
		const installationState =
			this.#installationStates.get(definition.id) ??
			(!installSource && state !== 'error'
				? firstBootSetup
					? firstBootSetup.manual
						? 'ready-for-setup'
						: firstBootSetupActive
							? 'setting-up'
							: 'setup-delayed'
					: (!!installMedia && installMedia !== 'media/seed.iso') || !!bootMedia
						? 'ready-for-setup'
						: undefined
				: undefined)
		return {
			...publicDefinition,
			networkMode: definition.networkMode ?? 'nat',
			ipAddress: machineIpAddressSchema.parse(definition.ipAddress),
			memoryGb: definition.memoryMb / 1_024,
			usbDevices: definition.usbDevices ?? [],
			firstBootSetup: firstBootSetupPending,
			installPending: !!installSource,
			// Cloud-init seed media is an internal implementation detail. Installer
			// media is user-managed when setup does not already own its lifecycle.
			installationMediaAttached:
				!firstBootSetup && ((!!installMedia && installMedia !== 'media/seed.iso') || !!bootMedia),
			state,
			installationState,
			installProgress:
				installationState && installationState !== 'ready-for-setup'
					? (this.#installProgress.get(definition.id) ?? 100)
					: undefined,
			// The exact catalog image this install sources from. osId only stores
			// the family, which cannot disambiguate variants or custom images.
			installOsId: state === 'installing' ? definition.installSource?.osId : undefined,
			errorMessage:
				(!externalDiskAvailable ? '[machine-external-disk-unavailable]' : this.#errors.get(definition.id)) ??
				(state === 'error' && installSource ? '[machine-install-interrupted]' : undefined),
			storageUsedGb:
				this.#libvirt.available && !installSource && externalDiskAvailable
					? await this.#libvirt.diskUsage(await this.#diskSystemPath(definition))
					: 0,
			acceleration,
			performanceWarning:
				acceleration === 'tcg'
					? definition.arch === hostArchitecture()
						? 'Hardware virtualization is unavailable. This machine is using slower software emulation.'
						: `This ${definition.arch} machine is running through cross-architecture software emulation.`
					: undefined,
		}
	}

	async list() {
		// API subscriptions can begin while the Machines module is still starting.
		// Make the one-time address migration part of the read boundary as well so
		// a restored pre-network definition never leaks an invalid public view.
		return Promise.all((await this.#ensureIpAddresses()).map((definition) => this.#view(definition)))
	}

	async exists(id: string) {
		return this.#store
			.read(id)
			.then(() => true)
			.catch(() => false)
	}

	async #collectRuntimeResourceUsage() {
		const definitions = await this.#store.list()
		const sampledAt = process.hrtime.bigint()
		const stats = this.#libvirt.available ? await this.#libvirt.resourceStats() : []
		const statsById = new Map(stats.map((stat) => [stat.id, stat]))
		// domstats --list-running is the source of truth for runtime consumers.
		// Keep running-but-idle machines (whose counters may legitimately be 0),
		// while omitting stopped definitions that consume no host CPU or memory.
		const runningDefinitions = definitions.filter((definition) => statsById.has(definition.id))
		const elapsedNs = this.#previousCpuSample ? Number(sampledAt - this.#previousCpuSample.at) : 0
		const threads = Math.max(1, os.cpus().length)
		const cpu = runningDefinitions.map((definition) => {
			const current = statsById.get(definition.id)?.cpuTimeNs ?? 0
			const previous = this.#previousCpuSample?.times.get(definition.id)
			const used =
				previous === undefined || elapsedNs <= 0
					? 0
					: Math.min(100, Math.max(0, ((current - previous) / elapsedNs / threads) * 100))
			return {id: definition.id, name: definition.name, osId: definition.osId, used}
		})
		const memory = runningDefinitions.map((definition) => ({
			id: definition.id,
			name: definition.name,
			osId: definition.osId,
			used: statsById.get(definition.id)?.memoryBytes ?? 0,
		}))
		this.#previousCpuSample = {at: sampledAt, times: new Map(stats.map((stat) => [stat.id, stat.cpuTimeNs]))}
		return {cpu, memory}
	}

	async runtimeResourceUsage() {
		if (this.#runtimeUsageCache && this.#runtimeUsageCache.expiresAt > Date.now()) {
			return this.#runtimeUsageCache.value
		}
		if (this.#runtimeUsageInFlight) return this.#runtimeUsageInFlight
		this.#runtimeUsageInFlight = this.#collectRuntimeResourceUsage()
		try {
			const value = await this.#runtimeUsageInFlight
			this.#runtimeUsageCache = {expiresAt: Date.now() + 750, value}
			return value
		} finally {
			this.#runtimeUsageInFlight = undefined
		}
	}

	async storageResourceUsage(): Promise<MachineResourceUsage[]> {
		return Promise.all(
			(await this.#store.list()).map(async (definition) => {
				const diskAvailable = await this.#externalDiskAvailable(definition)
				return {
					id: definition.id,
					name: definition.name,
					osId: definition.osId,
					used:
						this.#libvirt.available && diskAvailable
							? await this.#libvirt.diskUsageBytes(await this.#diskSystemPath(definition))
							: 0,
				}
			}),
		)
	}

	async consoleSocket(id: string) {
		await this.#definition(id)
		if ((await this.#libvirt.state(id)) !== 'running') throw new Error('[machine-not-running]')
		const socket = this.#libvirt.displaySocket(id)
		if (!(await fse.pathExists(socket))) throw new Error('[machine-console-unavailable]')
		return socket
	}

	async #withDisplay<T>(id: string, operation: (client: RfbClient) => Promise<T>) {
		const client = await RfbClient.connect(await this.consoleSocket(id))
		try {
			return await operation(client)
		} finally {
			client.close()
		}
	}

	async screenshot(id: string, {agent}: {agent?: MachineAgent} = {}) {
		const screenshot = await this.#withDisplay(id, async (client) =>
			encodeScreenshot(await client.captureFramebuffer()),
		)
		// Looking keeps an agent's turn at the console alive, but does not begin one
		if (agent && this.#agentControls.get(id)?.agent.tokenId === agent.tokenId) this.#touchAgentControl(id, agent)
		return screenshot
	}

	// Performs one keyboard or pointer action at the console and returns the
	// screen afterwards, the way a person acts and then looks
	async control(id: string, action: MachineInputAction, {agent}: {agent?: MachineAgent} = {}) {
		// Interleaved pointer/keyboard calls cannot have a truthful visual
		// sequence (and can leave modifiers held). Serialize each machine only.
		let queue = this.#inputQueues.get(id)
		if (!queue) {
			queue = new PQueue({concurrency: 1})
			this.#inputQueues.set(id, queue)
			const current = queue
			queue.on('idle', () => {
				if (this.#inputQueues.get(id) === current) this.#inputQueues.delete(id)
			})
		}
		return queue.add(() => this.#control(id, action, agent))
	}

	async #control(id: string, action: MachineInputAction, agent?: MachineAgent) {
		const definition = await this.#definition(id)
		const pointerSupported = !isLegacyPlatformProfile(definition.platformProfile)
		return this.#withDisplay(id, async (client) => {
			this.#activeInputs.add(id)
			clearTimeout(this.#agentControlTimers.get(id))
			try {
				const {pointer, primed} = await performInputAction(client, action, {
					pointerSupported,
					pointer: this.#agentPointers.get(id),
					primeFirstPress: definition.osId === 'android' && !this.#primedMachines.has(id),
					onPosition: (point) => this.#agentPointers.set(id, point),
					onUpdate: ({pointer, motion, feedback}) => {
						if (agent)
							this.#touchAgentControl(
								id,
								agent,
								pointer && {...pointer, width: client.width, height: client.height, motion},
								feedback,
							)
					},
				})
				if (primed) this.#primedMachines.add(id)
				if (pointer) this.#agentPointers.set(id, pointer)
				if (action.action !== 'wait') await new Promise((resolve) => setTimeout(resolve, MACHINE_INPUT_SETTLE_MS))
				const screenshot = await encodeScreenshot(await client.captureFramebuffer())
				if (agent && this.#agentControls.get(id)?.agent.tokenId === agent.tokenId) this.#touchAgentControl(id, agent)
				return screenshot
			} catch (error) {
				const current = this.#agentControls.get(id)
				if (
					agent &&
					current?.agent.tokenId === agent.tokenId &&
					current.feedback?.phase !== 'released' &&
					current.feedback?.phase !== 'complete'
				) {
					const pointer = this.#agentPointers.get(id)
					this.#touchAgentControl(id, agent, pointer && {...pointer, width: client.width, height: client.height}, {
						action: action.action,
						phase: 'complete',
					})
				}
				throw error
			} finally {
				this.#activeInputs.delete(id)
				this.#scheduleAgentControlExpiry(id)
			}
		})
	}

	agentControls(): Record<string, MachineAgentControl> {
		return Object.fromEntries(
			[...this.#agentControls].map(([id, control]) => [id, {...control, observedAt: Date.now()}]),
		)
	}

	#touchAgentControl(
		id: string,
		agent: MachineAgent,
		pointer?: MachineAgentControl['pointer'],
		feedback?: InputFeedback,
	) {
		const previous = this.#agentControls.get(id)
		const control: MachineAgentControl = {
			agent,
			lastInputAt: Date.now(),
			observedAt: Date.now(),
			sequence: feedback ? ++this.#inputSequence : (previous?.sequence ?? ++this.#inputSequence),
			feedback: feedback ? {...feedback, startedAt: Date.now()} : previous?.feedback,
			pointer: pointer ?? previous?.pointer,
		}
		this.#agentControls.set(id, control)
		this.#scheduleAgentControlExpiry(id)
		// Heartbeats only renew server-side expiry; they do not change the visual state.
		if (feedback || pointer || !previous || previous.agent.tokenId !== agent.tokenId)
			this.#umbreld.eventBus.emit('machines:agent-control', {machineId: id, control})
	}

	#scheduleAgentControlExpiry(id: string) {
		clearTimeout(this.#agentControlTimers.get(id))
		this.#agentControlTimers.delete(id)
		const control = this.#agentControls.get(id)
		if (!control || this.#activeInputs.has(id)) return
		// Restore the remaining idle time without counting unrelated or rejected
		// requests as fresh activity by the current agent.
		const remainingMs = Math.max(0, control.lastInputAt + agentControlTimeoutMs() - Date.now())
		const timer = setTimeout(() => this.#clearAgentControl(id), remainingMs)
		timer.unref()
		this.#agentControlTimers.set(id, timer)
	}

	#clearAgentControl(id: string) {
		clearTimeout(this.#agentControlTimers.get(id))
		this.#agentControlTimers.delete(id)
		if (!this.#agentControls.delete(id)) return
		this.#umbreld.eventBus.emit('machines:agent-control', {machineId: id, control: null})
	}

	// The remembered pointer outlives an agent's turn: the guest's pointer is
	// still where it was left. It is only wrong once the guest has gone away.
	#forgetMachineInput(id: string) {
		this.#agentPointers.delete(id)
		this.#primedMachines.delete(id)
		this.#clearAgentControl(id)
	}

	// Whether the guest is running a clipboard agent the console can share with
	async clipboardSharing(id: string) {
		await this.#definition(id)
		return this.#libvirt.clipboardAgentConnected(id)
	}

	async audioCaptureSource(id: string) {
		await this.#definition(id)
		return this.#libvirt.audioCaptureSource(id)
	}

	async #assertUniqueName(name: string, excludingId?: string) {
		const normalized = name.trim().toLowerCase()
		if (
			(await this.#store.list()).some(
				(machine) => machine.id !== excludingId && machine.name.toLowerCase() === normalized,
			)
		) {
			throw new Error('[machine-name-taken]')
		}
	}

	async #ensureIpAddressesUnlocked() {
		const definitions = await this.#store.list()
		const assigned: MachineDefinition[] = []
		const used = new Set<string>()
		for (const definition of definitions) {
			const valid = machineIpAddressSchema.safeParse(definition.ipAddress)
			if (!valid.success || used.has(valid.data)) {
				definition.ipAddress = nextMachineIpAddress(assigned)
				await this.#store.write(definition)
			}
			used.add(definition.ipAddress!)
			assigned.push(definition)
		}
		return definitions
	}

	async #ensureIpAddresses() {
		return this.#createQueue.add(() => this.#ensureIpAddressesUnlocked())
	}

	#assertBackupIdle(id?: string) {
		if (this.#backupActive || (id && this.#backupMachines.has(id))) throw new Error('[machine-backup-in-progress]')
	}

	async #assertPortsCanBind(forwards: PortForward[]) {
		for (const forward of forwards) {
			await new Promise<void>((resolve, reject) => {
				if (forward.protocol === 'tcp') {
					const server = net.createServer()
					server.once('error', () => reject(new Error('[machine-port-conflict]')))
					server.listen(forward.hostPort, '0.0.0.0', () => server.close(() => resolve()))
					return
				}
				const socket = dgram.createSocket('udp4')
				socket.once('error', () => {
					socket.close()
					reject(new Error('[machine-port-conflict]'))
				})
				socket.bind(forward.hostPort, '0.0.0.0', () => {
					socket.close()
					resolve()
				})
			})
		}
	}

	async #createCloudInitSeed(
		directory: string,
		definition: MachineDefinition,
		password: string,
		provisioning: CloudInitProvisioning = {},
		completionUrl?: string,
		signal?: AbortSignal,
	) {
		if (signal?.aborted) throw signal.reason
		const commandOptions = signal
			? installCommandOptions(signal, MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS)
			: {timeout: MACHINE_INSTALL_SHORT_COMMAND_TIMEOUT_MS}
		const {stdout: passwordHash} = await execa('mkpasswd', ['--method=sha-512', '--stdin'], {
			...commandOptions,
			input: password,
		})
		const seedDirectory = nodePath.join(directory, 'media')
		await fse.ensureDir(seedDirectory)
		const userData = renderCloudInitUserData(definition.username!, passwordHash.trim(), provisioning, completionUrl)
		const metadata = `instance-id: ${definition.uuid}\nlocal-hostname: ${slugifyHostname(definition.name)}\n`
		await Promise.all([
			fsp.writeFile(nodePath.join(seedDirectory, 'user-data'), userData, {mode: 0o600}),
			fsp.writeFile(nodePath.join(seedDirectory, 'meta-data'), metadata, {mode: 0o600}),
		])
		await execa(
			'cloud-localds',
			[
				nodePath.join(seedDirectory, 'seed.iso'),
				nodePath.join(seedDirectory, 'user-data'),
				nodePath.join(seedDirectory, 'meta-data'),
			],
			commandOptions,
		)
		await Promise.all([
			fse.remove(nodePath.join(seedDirectory, 'user-data')),
			fse.remove(nodePath.join(seedDirectory, 'meta-data')),
		])
	}

	async #assertCreationSpace(diskSizeGb: number, imageSizeMb: number, directory = this.#store.root) {
		const stats = await fsp.statfs(directory)
		const available = stats.bavail * stats.bsize
		if (available < requiredMachineCreationBytes(diskSizeGb, imageSizeMb)) {
			throw new Error('[machine-insufficient-storage]')
		}
	}

	async #prepareMachineInstall(
		definition: MachineDefinition,
		credentials: MachineInstallCredentials,
		signal: AbortSignal,
	) {
		if (signal.aborted) throw signal.reason
		const installSource = definition.installSource
		if (!installSource) throw new Error('[machine-install-not-pending]')
		this.#assertExternalStorageNotBlocked(definition)
		const machineDirectory = this.#store.directory(definition.id)
		const stagingDirectory = nodePath.join(machineDirectory, 'operations', 'install-staging')
		const externalDisk = definition.diskPath ? await this.#diskSystemPath(definition) : undefined
		const externalDiskStaging = externalDisk ? `${externalDisk}.installing` : undefined
		const diskDestination = externalDiskStaging ?? nodePath.join(stagingDirectory, 'disk.qcow2')
		await fse.remove(stagingDirectory)
		await Promise.all(
			['disk.qcow2', 'media', 'nvram.fd', 'tpm'].map((entry) => fse.remove(nodePath.join(machineDirectory, entry))),
		)
		if (externalDisk) {
			await fse.ensureDir(nodePath.dirname(externalDisk))
			await Promise.all([fse.remove(externalDisk), fse.remove(externalDiskStaging!)])
		}
		await fse.ensureDir(stagingDirectory)

		try {
			let source: string
			let sourceImage: InternalOsImage | undefined
			if (installSource.osId) {
				sourceImage = this.#getOsImage(installSource.osId)
				await this.#ensureImageDownloaded(sourceImage, `machine:${definition.id}`, signal)
				if (!sourceImage.fileName) throw new Error('[os-image-not-downloaded]')
				source = nodePath.join(this.#imageDirectory(sourceImage.id), sourceImage.fileName)
			} else {
				source = await this.#umbreld.files.virtualToSystemPath(installSource.imagePath!, OWNER_USER_ID)
				if (!(await fse.stat(source)).isFile()) throw new Error('[machine-image-invalid]')
				this.#installProgress.set(definition.id, 70)
			}
			if (signal.aborted) throw signal.reason

			const isIso = /\.iso$/i.test(source)
			const unattended = !!sourceImage && !sourceImage.custom && sourceImage.requiresCredentials
			const completionUrl = credentials.firstBootToken
				? `http://${MACHINE_GUEST_HOST_ADDRESS}:${this.#umbreld.port}/api/machines/first-boot/${definition.id}/${credentials.firstBootToken}`
				: undefined
			this.#installProgress.set(definition.id, 72)
			await this.#emitMachines()

			if (isIso) {
				if (sourceImage?.windows?.installer === 'windows-98') {
					await this.#libvirt.createWindows98Disk(diskDestination, definition.diskSizeGb, signal)
				} else {
					await this.#libvirt.createDisk(diskDestination, definition.diskSizeGb, signal)
				}
				await fse.ensureDir(nodePath.join(stagingDirectory, 'media'))
				if (sourceImage?.windows) {
					if (!completionUrl || !credentials.username || (!sourceImage.manualSetup && !credentials.password)) {
						throw new Error('[machine-credentials-required]')
					}
					const virtio = sourceImage.resources?.find(({id}) => id.startsWith('virtio-win'))
					const patcher9x = sourceImage.resources?.find(({id}) => id.startsWith('patcher9x'))
					const windows98Boot = sourceImage.resources?.find(({id}) => id.startsWith('windows-98-se-usb-boot'))
					await prepareWindowsInstallMedia(
						source,
						nodePath.join(stagingDirectory, definition.installMedia!),
						{
							installer: sourceImage.windows.installer,
							arch: definition.arch,
							username: credentials.username,
							password: credentials.password ?? '',
							licenseKey: credentials.licenseKey,
							completionUrl,
							virtioIso: virtio ? this.#resourcePath(virtio) : undefined,
							patcher9xArchive: patcher9x ? this.#resourcePath(patcher9x) : undefined,
							windows98BootImage: windows98Boot ? this.#resourcePath(windows98Boot) : undefined,
							bootFloppyDestination: definition.bootMedia
								? nodePath.join(stagingDirectory, definition.bootMedia)
								: undefined,
						},
						signal,
					)
				} else {
					await fse.copy(source, nodePath.join(stagingDirectory, definition.installMedia!))
					if (signal.aborted) throw signal.reason
				}
				this.#installProgress.set(definition.id, 92)
			} else {
				const inputFormat = sourceImage?.diskFormat ?? qemuImageFormatForPath(source)
				await this.#libvirt.convertDisk(
					source,
					diskDestination,
					definition.diskSizeGb,
					inputFormat,
					signal,
					(percent) => {
						this.#installProgress.set(definition.id, 72 + percent * 0.2)
						void this.#emitMachines().catch((error) =>
							this.logger.error('Failed emitting machine clone progress', error),
						)
					},
				)
			}
			if (signal.aborted) throw signal.reason

			if (sourceImage?.familyId === 'omarchy') {
				await prepareOmarchySeed(
					stagingDirectory,
					{
						hostname: slugifyHostname(definition.name),
						diskSizeGb: definition.diskSizeGb,
						username: credentials.username!,
						password: credentials.password!,
						completionUrl: completionUrl!,
					},
					signal,
				)
			} else if (unattended && !sourceImage?.windows) {
				await this.#createCloudInitSeed(
					stagingDirectory,
					definition,
					credentials.password!,
					sourceImage?.cloudInit,
					completionUrl,
					signal,
				)
			}
			await this.#libvirt.initializeNvram(definition, stagingDirectory, signal)
			this.#installProgress.set(definition.id, 96)
			await this.#emitMachines()

			for (const entry of await fsp.readdir(stagingDirectory)) {
				if (signal.aborted) throw signal.reason
				await fse.move(nodePath.join(stagingDirectory, entry), nodePath.join(machineDirectory, entry), {
					overwrite: false,
				})
			}
			if (signal.aborted) throw signal.reason
			if (externalDisk) await fse.move(externalDiskStaging!, externalDisk, {overwrite: false})
			// Settings can be changed while a background image download or clone is
			// running. Reload the canonical definition before completing the install
			// so this job cannot overwrite newer user changes with its stale snapshot.
			const currentDefinition = await this.#definition(definition.id)
			if (currentDefinition.firstBootSetup) currentDefinition.firstBootSetup.startedAt = Date.now()
			delete currentDefinition.installSource
			await this.#store.write(currentDefinition)
			this.#installProgress.set(definition.id, 100)
		} finally {
			await fse.remove(stagingDirectory)
			if (externalDiskStaging) await fse.remove(externalDiskStaging)
		}
	}

	async #launchInstall(definition: MachineDefinition, credentials: MachineInstallCredentials) {
		if (this.#installJobs.has(definition.id)) throw new Error('[machine-install-in-progress]')
		const controller = new AbortController()
		this.#operations.set(definition.id, 'installing')
		this.#installationStates.set(definition.id, 'preparing')
		this.#errors.delete(definition.id)
		this.#installCredentials.set(definition.id, credentials)
		this.#installProgress.set(definition.id, 0)

		const promise = (async () => {
			try {
				await this.#prepareMachineInstall(definition, credentials, controller.signal)
				this.#installCredentials.delete(definition.id)
				this.#installationStates.set(definition.id, 'starting')
				if (!controller.signal.aborted) await this.startMachine(definition.id)
			} catch (error) {
				if (!controller.signal.aborted) {
					const message = error instanceof Error ? error.message : String(error)
					this.#errors.set(definition.id, message)
					this.logger.error(`Failed installing machine ${definition.id}`, error)
				}
			} finally {
				this.#operations.delete(definition.id)
				this.#installProgress.delete(definition.id)
				this.#installationStates.delete(definition.id)
				if (this.#installJobs.get(definition.id)?.controller === controller) this.#installJobs.delete(definition.id)
				await this.#emitMachines().catch((error) =>
					this.logger.error(`Failed emitting final machine install state for ${definition.id}`, error),
				)
			}
		})()
		this.#installJobs.set(definition.id, {controller, promise})
		await this.#emitMachines()
	}

	async create({
		name,
		osId,
		imagePath,
		diskSizeGb,
		cores,
		memoryGb,
		firmware,
		diskBus,
		diskDirectory,
		username,
		password,
		licenseKey,
		arch = hostArchitecture(),
		platformProfile,
		networkMode = 'nat',
	}: {
		name: string
		osId?: string
		imagePath?: string
		diskSizeGb: number
		cores: number
		memoryGb: number
		firmware?: 'uefi' | 'bios'
		diskBus?: 'virtio' | 'sata'
		diskDirectory?: string
		username?: string
		password?: string
		licenseKey?: string
		arch?: MachineArchitecture
		platformProfile?: PlatformProfile
		networkMode?: MachineNetworkMode
	}) {
		this.#assertBackupIdle()
		if (!this.#libvirt.available) throw new Error('[virtualization-unavailable]')
		if (networkMode === 'bridged') await this.#assertLanBridgeAvailable()
		await this.#assertUniqueName(name)
		const profile = platformProfile ?? defaultPlatformProfile(arch)
		if (architectureForProfile(profile) !== arch) throw new Error('[machine-platform-architecture-mismatch]')
		if (osId && (firmware || diskBus || diskDirectory)) throw new Error('[machine-custom-setting-catalog-image]')
		if (arch === 'arm64' && (firmware === 'bios' || diskBus === 'sata')) {
			throw new Error('[machine-custom-setting-unsupported-on-arm]')
		}

		let normalizedDiskDirectory: string | undefined
		let diskDirectorySystemPath: string | undefined
		if (diskDirectory) {
			normalizedDiskDirectory = nodePath.posix.normalize(diskDirectory)
			if (!(normalizedDiskDirectory.startsWith('/External/') || normalizedDiskDirectory.startsWith('/Network/'))) {
				throw new Error('[machine-external-disk-location-invalid]')
			}
			diskDirectorySystemPath = await this.#umbreld.files.virtualToSystemPath(normalizedDiskDirectory, OWNER_USER_ID)
			if (!(await fse.stat(diskDirectorySystemPath)).isDirectory()) {
				throw new Error('[machine-external-disk-location-invalid]')
			}
			if (!(await this.#umbreld.files.getAllowedOperations(normalizedDiskDirectory)).includes('writable')) {
				throw new Error('[machine-external-disk-location-readonly]')
			}
		}

		let sourceImage: InternalOsImage | undefined
		let sourceName: string
		let isIso: boolean
		let imageSizeMb: number
		if (osId) {
			sourceImage = this.#getOsImage(osId)
			if (sourceImage.arch !== arch && !sourceImage.custom) throw new Error('[machine-catalog-architecture-mismatch]')
			if (sourceImage.requiresCredentials && (!username || (!sourceImage.manualSetup && !password))) {
				throw new Error('[machine-credentials-required]')
			}
			if (sourceImage.windows && username && !/^[a-z0-9][a-z0-9_.-]{0,19}$/i.test(username)) {
				throw new Error('[machine-windows-username-invalid]')
			}
			const requiresLicenseKey =
				sourceImage.windows?.installer === 'windows-xp' || sourceImage.windows?.installer === 'windows-98'
			if (requiresLicenseKey && !/^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}$/i.test(licenseKey ?? '')) {
				throw new Error('[machine-windows-license-key-required]')
			}
			if (licenseKey && !requiresLicenseKey) throw new Error('[machine-windows-license-key-unexpected]')
			const sourceFile = sourceImage.fileName ?? new URL(sourceImage.sourceUrl!).pathname
			isIso = /\.iso$/i.test(sourceFile)
			sourceName = sourceImage.variantName ? `${sourceImage.name} ${sourceImage.variantName}` : sourceImage.name
			imageSizeMb = sourceImage.sizeMb
		} else if (imagePath) {
			if (!CUSTOM_IMAGE_EXTENSIONS.test(imagePath)) throw new Error('[machine-image-invalid]')
			const source = await this.#umbreld.files.virtualToSystemPath(imagePath, OWNER_USER_ID)
			const stats = await fse.stat(source)
			if (!stats.isFile()) throw new Error('[machine-image-invalid]')
			isIso = /\.iso$/i.test(source)
			sourceName = nodePath.basename(source).replace(CUSTOM_IMAGE_EXTENSIONS, '')
			imageSizeMb = Math.ceil(stats.size / 1_000_000)
		} else {
			throw new Error('[machine-os-required]')
		}

		await this.#assertCreationSpace(
			diskSizeGb,
			diskDirectorySystemPath ? 0 : imageSizeMb,
			diskDirectorySystemPath ?? this.#store.root,
		)

		const stagingDirectory = nodePath.join(this.#store.root, `.creating-${randomUUID()}`)
		const unattended = !!sourceImage && !sourceImage.custom && sourceImage.requiresCredentials
		const tracksFirstBootSetup = unattended
		const firstBootToken = tracksFirstBootSetup ? randomBytes(32).toString('hex') : undefined
		const machineProfile = sourceImage?.platformProfile ?? profile
		const definition: MachineDefinition = {
			version: 1,
			id: slugifyMachineId(name),
			name: name.trim(),
			osId: sourceImage?.custom ? 'custom' : (sourceImage?.familyId ?? 'custom'),
			osName: sourceName,
			osVersion: sourceImage?.version ?? (isIso ? 'Custom ISO' : 'Custom disk image'),
			osVariant: sourceImage?.variantName,
			arch,
			platformProfile: machineProfile,
			machineType: defaultMachineType(machineProfile),
			firmware:
				firmware ?? (['legacy-x86', 'windows-7-x86', 'windows-98-x86'].includes(machineProfile) ? 'bios' : 'uefi'),
			diskBus: imagePath ? (diskBus ?? 'virtio') : undefined,
			uuid: randomUUID(),
			macAddress: randomMacAddress(),
			networkMode,
			diskSizeGb,
			cores,
			memoryMb: sourceImage?.fixedMemoryMb ?? memoryGb * 1_024,
			username: unattended ? username : undefined,
			autostart: true,
			pinned: false,
			createdAt: Date.now(),
			firstBootSetup: firstBootToken
				? {
						startedAt: Date.now(),
						tokenHash: createHash('sha256').update(firstBootToken).digest('hex'),
						manual: sourceImage?.manualSetup || undefined,
					}
				: undefined,
			installSource: osId ? {osId} : {imagePath: imagePath!},
			secureBoot: sourceImage?.windows?.installer === 'windows-11' ? true : undefined,
			tpm: sourceImage?.windows?.installer === 'windows-11' ? true : undefined,
			installMedia: isIso
				? sourceImage?.windows?.installer === 'windows-11' && arch === 'arm64'
					? 'media/install.img'
					: 'media/install.iso'
				: unattended
					? 'media/seed.iso'
					: undefined,
			bootMedia: sourceImage?.windows?.installer === 'windows-98' ? 'media/boot.img' : undefined,
			seedMedia: sourceImage?.familyId === 'omarchy' ? 'media/seed.iso' : undefined,
			portForwards: [],
		}

		try {
			await fse.ensureDir(nodePath.join(stagingDirectory, 'operations'))
			await this.#createQueue.add(async () => {
				const existing = await this.#ensureIpAddressesUnlocked()
				const activeLeases = (await this.#libvirt.leasedIpAddresses()).map((ipAddress) => ({ipAddress}))
				definition.ipAddress = nextMachineIpAddress([...existing, ...activeLeases])
				const baseId = definition.id
				for (let attempt = 1; ; attempt++) {
					definition.id = machineIdCandidate(baseId, attempt)
					definition.diskPath = normalizedDiskDirectory
						? nodePath.posix.join(normalizedDiskDirectory, `${definition.id}.qcow2`)
						: undefined
					if (definition.diskPath && (await fse.pathExists(await this.#diskSystemPath(definition)))) continue
					await this.#store.write(definition, stagingDirectory)
					try {
						await fsp.rename(stagingDirectory, this.#store.directory(definition.id))
						break
					} catch (error) {
						const code = (error as NodeJS.ErrnoException).code
						if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error
					}
				}
			})
		} catch (error) {
			await fse.remove(stagingDirectory)
			throw error
		}

		await this.#libvirt.reconcileNetwork(await this.#store.list())
		await this.#launchInstall(definition, {
			username,
			password,
			licenseKey: licenseKey?.toUpperCase(),
			firstBootToken,
		})
		return this.#view(definition)
	}

	async retryInstall(id: string) {
		return this.#withMachineLock(id, async () => {
			this.#assertBackupIdle(id)
			const definition = await this.#definition(id)
			if (!definition.installSource) throw new Error('[machine-install-not-pending]')
			let credentials = this.#installCredentials.get(id)
			if (!credentials) {
				const sourceImage = definition.installSource.osId ? this.#getOsImage(definition.installSource.osId) : undefined
				const requiresLicenseKey =
					sourceImage?.windows?.installer === 'windows-xp' || sourceImage?.windows?.installer === 'windows-98'
				if (sourceImage?.requiresCredentials && (!sourceImage.manualSetup || requiresLicenseKey)) {
					throw new Error('[machine-install-retry-credentials-required]')
				}
				const firstBootToken = sourceImage?.windows ? randomBytes(32).toString('hex') : undefined
				if (firstBootToken) {
					definition.firstBootSetup = {
						startedAt: Date.now(),
						tokenHash: createHash('sha256').update(firstBootToken).digest('hex'),
						manual: sourceImage?.manualSetup || undefined,
					}
					await this.#store.write(definition)
				}
				credentials = {username: definition.username, firstBootToken}
			}
			await this.#launchInstall(definition, credentials)
			return true
		})
	}

	async completeFirstBootSetup(id: string, token: string) {
		return this.#withMachineLock(id, async () => {
			this.#assertBackupIdle(id)
			const definition = await this.#definition(id)
			if (!definition.firstBootSetup || !firstBootTokenMatches(token, definition.firstBootSetup.tokenHash)) {
				throw new Error('[machine-first-boot-token-invalid]')
			}
			delete definition.firstBootSetup
			if (definition.installMedia || definition.bootMedia) {
				try {
					await this.#libvirt.ejectInstallMedia(definition)
				} catch (error) {
					this.logger.error(`Failed to detach completed setup media for ${id}`, error)
				}
				if (definition.installMedia) {
					await fse.remove(nodePath.join(this.#store.directory(id), definition.installMedia))
					delete definition.installMedia
				}
				if (definition.bootMedia) {
					await fse.remove(nodePath.join(this.#store.directory(id), definition.bootMedia))
					delete definition.bootMedia
				}
				if (definition.seedMedia) {
					await fse.remove(nodePath.join(this.#store.directory(id), definition.seedMedia))
					delete definition.seedMedia
				}
			}
			await this.#store.write(definition)
			if (definition.osId === 'omarchy') await removeOmarchySetupCredentials(this.#store.directory(id))
			await this.#emitMachines()
			if (machineJoinsLan(definition)) {
				void this.#joinLanAfterSetup(id).catch((error) =>
					this.logger.error(`Failed to move machine ${id} onto the LAN after setup`, error),
				)
			}
			return true
		})
	}

	// A bridged machine sets up on the private network so it can call home to
	// Umbrel. Once it has, move it onto the LAN. Wait a moment first so the
	// guest receives the reply to the call that brought it here.
	async #joinLanAfterSetup(id: string) {
		await delay(JOIN_LAN_AFTER_SETUP_DELAY_MS)
		await this.#withMachineLock(id, async () => {
			const definition = await this.#definition(id)
			if (!machineJoinsLan(definition) || (await this.#libvirt.state(id)) !== 'running') return
			await this.#lanBridge.ensure()
			await this.#libvirt.joinLan(definition)
		})
	}

	async #assertLanBridgeAvailable() {
		const availability = await this.#lanBridge.availability()
		if (!availability.available) throw new Error(`[machine-lan-bridge-unavailable-${availability.reason}]`)
	}

	// Give Umbrel's address back to its wired interface once no machine is
	// configured to join the LAN. The bridge waits for bridged machines that are
	// still running to stop.
	async #releaseLanBridge(definitions: MachineDefinition[]) {
		const bridged = (list: MachineDefinition[]) => list.some((definition) => definition.networkMode === 'bridged')
		if (this.#lanBridgeRelease || bridged(definitions)) return
		if (!(await fse.pathExists(`/sys/class/net/${MACHINE_LAN_BRIDGE}`))) return
		// Handing the address back can take a while, so don't hold up the poll
		this.#lanBridgeRelease = this.#lanBridge
			.remove(async () => bridged(await this.#store.list()))
			.catch((error) => this.logger.error('Failed to remove the machine LAN bridge', error))
			.finally(() => (this.#lanBridgeRelease = undefined))
	}

	async startMachine(id: string) {
		return this.#withMachineLock(id, async () => {
			this.#assertBackupIdle(id)
			const definition = await this.#definition(id)
			if (definition.installSource) throw new Error('[machine-install-not-complete]')
			this.#assertExternalStorageNotBlocked(definition)
			if (!(await this.#externalDiskAvailable(definition))) throw new Error('[machine-external-disk-unavailable]')
			const state = await this.#libvirt.state(id)
			if (state === 'suspended') await this.#libvirt.stop(id, {force: true})
			else if (state !== 'stopped') throw new Error('[machine-not-stopped]')
			await this.#assertPortsCanBind(definition.portForwards)
			this.#operations.set(id, 'starting')
			this.#errors.delete(id)
			await this.#emitMachines()
			try {
				// The network is deliberately transient. Socket-activated libvirt
				// daemons can forget it while the last VM is stopped, so reconstruct it
				// before every manual start instead of assuming startup state survived.
				await this.#libvirt.reconcileNetwork(await this.#store.list())
				const joinLan = machineJoinsLanNow(definition)
				if (joinLan) await this.#lanBridge.ensure()
				await this.#libvirt.start(
					definition,
					this.#store.directory(id),
					await this.#diskSystemPath(definition),
					(await this.#usbDevicesToAttach(definition)).map(({device}) => ({bus: device.bus, device: device.device})),
					{joinLan},
				)
				definition.autostart = true
				await this.#store.write(definition)
			} catch (error) {
				this.#errors.set(id, error instanceof Error ? error.message : String(error))
				throw error
			} finally {
				this.#operations.delete(id)
				await this.#emitMachines()
			}
			return true
		})
	}

	async stopMachine(id: string) {
		this.#forgetMachineInput(id)
		return this.#withMachineLock(id, async () => {
			this.#assertBackupIdle(id)
			const definition = await this.#definition(id)
			if ((await this.#libvirt.state(id)) !== 'running') throw new Error('[machine-not-running]')
			this.#operations.set(id, 'stopping')
			await this.#emitMachines()
			try {
				await this.#libvirt.stop(id)
				definition.autostart = false
				await this.#store.write(definition)
			} finally {
				this.#operations.delete(id)
				await this.#emitMachines()
			}
			return true
		})
	}

	async restartMachine(id: string) {
		return this.#withMachineLock(id, async () => {
			this.#assertBackupIdle(id)
			const definition = await this.#definition(id)
			this.#operations.set(id, 'restarting')
			await this.#emitMachines()
			try {
				await this.#libvirt.restart(id)
				definition.autostart = true
				await this.#store.write(definition)
			} finally {
				this.#operations.delete(id)
				await this.#emitMachines()
			}
			return true
		})
	}

	async forceStopMachine(id: string) {
		this.#forgetMachineInput(id)
		this.#assertBackupIdle(id)
		// Cancellation happens before the lifecycle lock because the detached
		// install may be waiting to acquire that same lock before auto-starting.
		const install = this.#installJobs.get(id)
		if (install) install.controller.abort(new Error('[machine-install-cancelled]'))
		if (install) await install.promise

		return this.#withMachineLock(id, async () => {
			this.#assertBackupIdle(id)
			const definition = await this.#definition(id)
			if ((await this.#libvirt.state(id)) === 'stopped' && !this.#operations.has(id) && !install) {
				throw new Error('[machine-already-stopped]')
			}
			await this.#libvirt.stop(id, {force: true})
			definition.autostart = false
			await this.#store.write(definition)
			this.#operations.delete(id)
			this.#errors.delete(id)
			await this.#emitMachines()
			return true
		})
	}

	async uninstall(id: string) {
		this.#assertBackupIdle(id)
		// Abort background preparation before waiting for the lifecycle lock. The
		// install job may itself be queued to start this machine after conversion.
		const install = this.#installJobs.get(id)
		if (install) install.controller.abort(new Error('[machine-install-cancelled]'))
		if (install) await install.promise

		return this.#withMachineLock(id, async () => {
			this.#assertBackupIdle(id)
			const definition = await this.#definition(id)
			const externalDisk = definition.diskPath
				? await this.#diskSystemPath(definition).catch(() => undefined)
				: undefined
			if ((await this.#libvirt.state(id)) !== 'stopped') await this.#libvirt.stop(id, {force: true})
			this.#operations.delete(id)
			this.#errors.delete(id)
			this.#installCredentials.delete(id)
			this.#installProgress.delete(id)
			this.#installationStates.delete(id)
			const hadDevices = definition.usbDevices?.length ? await this.#pluggedInUsbDevices(id) : []
			await this.#store.remove(id)
			this.#forgetMachineInput(id)
			this.#forgetUsbDevices(id)
			if (definition.usbDevices?.length) {
				await this.#syncUsbReservations()
				this.#returnReleasedDrives(hadDevices)
			}
			// MCP bookkeeping is best effort, a failure here must never abort the uninstall
			await this.#umbreld.mcp
				.removeMachineGrant(id)
				.catch((error) => this.logger.error(`Failed to remove MCP grant for machine ${id}`, error))
			if (externalDisk) await fse.remove(externalDisk)
			await this.#libvirt.cleanupRuntime(id)
			await this.#libvirt.reconcileNetwork(await this.#store.list())
			await this.#emitMachines()
			return true
		})
	}

	async #validatePortForwards(id: string, forwards: PortForward[]) {
		const seen = new Set<string>()
		for (const forward of forwards) {
			if (forward.hostPort < MACHINES_PORT_MIN || forward.hostPort > MACHINES_PORT_MAX) {
				throw new Error('[machine-port-outside-reserved-range]')
			}
			const key = `${forward.protocol}:${forward.hostPort}`
			if (seen.has(key)) throw new Error('[machine-port-conflict]')
			seen.add(key)
		}
		for (const machine of await this.#store.list()) {
			if (machine.id === id) continue
			for (const forward of machine.portForwards) {
				if (seen.has(`${forward.protocol}:${forward.hostPort}`)) throw new Error('[machine-port-conflict]')
			}
		}
		const appPorts = new Set(
			(await Promise.all(this.#umbreld.apps.instances.map((app) => app.readManifest().catch(() => undefined))))
				.filter((manifest) => manifest !== undefined)
				.map((manifest) => manifest.port),
		)
		if (forwards.some((forward) => appPorts.has(forward.hostPort))) throw new Error('[machine-port-conflict]')
	}

	async assertAppPortAvailable(port: number) {
		// This range is formally reserved for Machines, so app installs and VM
		// configuration cannot race to claim a previously unused number.
		if (port >= MACHINES_PORT_MIN && port <= MACHINES_PORT_MAX) {
			throw new Error('[app-port-reserved-for-machines]')
		}
		for (const machine of await this.#store.list()) {
			if (machine.portForwards.some((forward) => forward.hostPort === port)) {
				throw new Error(`[app-port-reserved-by-machine] ${machine.name}`)
			}
		}
	}

	async updateSettings(
		id: string,
		settings: {
			name?: string
			cores?: number
			memoryGb?: number
			firmware?: 'uefi' | 'bios'
			diskBus?: 'virtio' | 'sata'
			diskSizeGb?: number
			autostart?: boolean
			portForwards?: PortForward[]
			usbDevices?: UsbDeviceIdentity[]
			networkMode?: MachineNetworkMode
		},
	) {
		return this.#withMachineLock(id, async () => {
			this.#assertBackupIdle(id)
			const definition = await this.#definition(id)

			// Complete every fallible validation before changing firmware state or
			// resizing the disk. A rejected combined settings request must not leave
			// an irreversible partial change behind.
			if (settings.name !== undefined) await this.#assertUniqueName(settings.name, id)
			if (settings.firmware !== undefined || settings.diskBus !== undefined) {
				if (definition.osId !== 'custom') throw new Error('[machine-custom-setting-catalog-image]')
				if (definition.arch === 'arm64' && (settings.firmware === 'bios' || settings.diskBus === 'sata')) {
					throw new Error('[machine-custom-setting-unsupported-on-arm]')
				}
			}
			if (settings.portForwards !== undefined) await this.#validatePortForwards(id, settings.portForwards)
			// A bridged machine has its own address on the LAN, so it has nothing
			// to forward Umbrel's ports to
			const networkMode = settings.networkMode ?? definition.networkMode ?? 'nat'
			if (networkMode === 'bridged' && (settings.portForwards ?? definition.portForwards).length > 0) {
				throw new Error('[machine-port-forwards-nat-only]')
			}
			if (networkMode === 'bridged' && definition.networkMode !== 'bridged') await this.#assertLanBridgeAvailable()
			const usb =
				settings.usbDevices !== undefined ? await this.#validateUsbDevices(definition, settings.usbDevices) : undefined

			let diskResize: {path: string; sizeGb: number} | undefined
			if (settings.diskSizeGb !== undefined) {
				if (settings.diskSizeGb < definition.diskSizeGb) throw new Error('[machine-disk-shrink-not-allowed]')
				if (settings.diskSizeGb > definition.diskSizeGb) {
					const path = await this.#diskSystemPath(definition)
					const actualSizeBytes = await this.#libvirt.diskVirtualSizeBytes(path)
					const requestedSizeBytes = settings.diskSizeGb * QEMU_GIBIBYTE_BYTES
					if (requestedSizeBytes < actualSizeBytes) {
						throw new Error('[machine-disk-shrink-not-allowed]')
					}
					if (requestedSizeBytes > actualSizeBytes) diskResize = {path, sizeGb: settings.diskSizeGb}
				}
			}

			// Eject drives only once everything else is valid, so a rejected request
			// leaves them in Files
			try {
				await this.#ejectDrives(usb?.ejects ?? [])
			} catch (error) {
				this.#returnReleasedDrives()
				throw error
			}
			const hadDevices = usb ? await this.#pluggedInUsbDevices(id) : []

			if (settings.name !== undefined) definition.name = settings.name.trim()
			if (settings.cores !== undefined) definition.cores = settings.cores
			if (settings.memoryGb !== undefined) definition.memoryMb = settings.memoryGb * 1_024
			if (settings.firmware !== undefined || settings.diskBus !== undefined) {
				if (settings.firmware !== undefined) {
					definition.firmware = settings.firmware
					if (
						settings.firmware === 'uefi' &&
						!(await fse.pathExists(nodePath.join(this.#store.directory(id), 'nvram.fd')))
					) {
						await this.#libvirt.initializeNvram(definition, this.#store.directory(id))
					}
				}
				if (settings.diskBus !== undefined) definition.diskBus = settings.diskBus
			}
			if (diskResize) await this.#libvirt.resizeDisk(definition, diskResize.path, diskResize.sizeGb)
			if (settings.diskSizeGb !== undefined) definition.diskSizeGb = settings.diskSizeGb
			if (settings.autostart !== undefined) definition.autostart = settings.autostart
			if (settings.portForwards !== undefined) definition.portForwards = settings.portForwards
			// Takes effect the next time the machine starts
			if (settings.networkMode !== undefined) definition.networkMode = settings.networkMode
			if (usb) definition.usbDevices = usb.assignments.length > 0 ? usb.assignments : undefined
			await this.#store.write(definition)
			if (settings.portForwards !== undefined) await this.#libvirt.reconcileFirewall(await this.#store.list())
			// USB devices are hotpluggable, so a running machine gets them straight
			// away, and drives it no longer has go back to Files
			if (usb) {
				await this.#syncUsbReservations()
				await this.#reconcileUsbDevices(id)
				const hasDevices = await this.#pluggedInUsbDevices(id)
				this.#returnReleasedDrives(
					hadDevices.filter((device) => !hasDevices.some((other) => other.sysfsPath === device.sysfsPath)),
				)
			}
			await this.#emitMachines()
			return this.#view(definition)
		})
	}

	#usbAssignments(definitions: MachineDefinition[]) {
		return definitions.flatMap(({id, usbDevices = []}) => usbDevices.map((assignment) => ({machineId: id, assignment})))
	}

	// Switching a device on for a machine is asking for it to be taken from
	// whatever on the host is using it, if it can be
	async #validateUsbDevices(definition: MachineDefinition, requested: UsbDeviceIdentity[]) {
		if (requested.length > 0 && isLegacyPlatformProfile(definition.platformProfile)) {
			throw new Error('[machine-usb-unsupported]')
		}
		const others = this.#usbAssignments((await this.#store.list()).filter(({id}) => id !== definition.id))
		const {assignments, added} = planUsbAssignments({
			machineId: definition.id,
			current: definition.usbDevices,
			requested,
			others,
			devices: await listHostUsbDevices(),
		})
		const ejects: string[] = []
		for (const hostUse of (await this.#usbHostUses(added)).values()) {
			if (!hostUse.takeable) throw new Error(`[machine-usb-device-in-use] ${hostUse.reason}`)
			ejects.push(...(hostUse.disks ?? []))
		}
		return {assignments, ejects}
	}

	// What the host is using each device for, and whether a machine can still
	// have it: a drive Umbrel mounted in Files can be ejected, and apps using a
	// device through a kernel driver, or the host using a network adapter it
	// can manage without, lose it like an unplug. The host's only network
	// connection, drives used any other way, devices an app drives directly
	// through usbfs, and anything used outside an app stay with the host.
	async #usbHostUses(devices: HostUsbDevice[]) {
		const hostUses = new Map<HostUsbDevice, MachineUsbHostUse & {disks?: string[]}>()
		const uses = await usbHostUse(devices)
		if (uses.size === 0) return hostUses
		const reasons = [...uses.values()].map(({reason}) => reason)
		const appPids = reasons.includes('in-use') ? await getAppPids(this.#umbreld) : new Map<number, string>()
		const ejectable = reasons.includes('storage') ? await this.#ejectableDrives() : new Set<string>()
		for (const [device, use] of uses) {
			if (use.reason === 'storage') {
				const takeable = use.disks.every((disk) => ejectable.has(disk))
				hostUses.set(device, {reason: use.reason, disks: use.disks, takeable})
			} else if (use.reason === 'network') {
				hostUses.set(device, {reason: use.reason, takeable: !use.essential})
			} else {
				const appIds = use.processes.map((pid) => appPids.get(pid))
				const onlyApps = appIds.every((appId) => appId !== undefined)
				hostUses.set(device, {
					reason: use.reason,
					apps: onlyApps ? await this.#appNames([...new Set(appIds as string[])]) : undefined,
					takeable: onlyApps && !use.claimed,
				})
			}
		}
		return hostUses
	}

	// Drives Umbrel mounted in Files, except ones holding a machine's disk or
	// storage a running app uses, which Files won't eject
	async #ejectableDrives() {
		const definitions = await this.#store.list()
		const drives = await this.#umbreld.files.externalStorage.getMountedExternalDevices()
		const ejectable = new Set<string>()
		for (const drive of drives) {
			const roots = drive.partitions.flatMap((partition) => partition.mountpoints)
			if (definitions.some(({diskPath}) => diskPath && this.#storagePathIsWithin(diskPath, roots))) continue
			const apps = await Promise.all(roots.map((root) => this.#umbreld.apps.getAppsUsingStorageSource(root)))
			if (apps.flat().length === 0) ejectable.add(drive.id)
		}
		return ejectable
	}

	async #appNames(ids: string[]) {
		return Promise.all(
			ids.map(async (id) => {
				const app = this.#umbreld.apps.instances.find((app) => app.id === id)
				const name = await app
					?.readManifest()
					.then((manifest) => manifest.name)
					.catch(() => undefined)
				return {id, name: name ?? id}
			}),
		)
	}

	async #ejectDrives(disks: string[]) {
		for (const disk of disks) await this.#umbreld.files.externalStorage.unmountExternalDevice(disk, {remove: false})
	}

	// Drives are left alone while they're assigned to a machine, so mount the
	// ones that no longer are, after loading the media of these ones a machine
	// just let go of
	#returnReleasedDrives(devices: HostUsbDevice[] = []) {
		void (async () => {
			for (const device of devices) await this.#loadDriveMedia(device, {wait: true})
			await this.#umbreld.files.externalStorage.mountExternalDevices()
		})().catch((error) => this.logger.error('Failed mounting drives released by machines', error))
	}

	// A guest ejecting a drive, as desktop file managers do, tells the drive its
	// medium is gone. Many USB sticks keep saying so until they're unplugged,
	// even through the reset QEMU gives a device it lets go of, which leaves
	// whoever gets the drive next with an empty one. So whenever a drive
	// changes hands, load its medium again, as plugging it back in would. Once
	// QEMU lets go of a drive the host takes a moment to find its disks again,
	// so a drive a machine just released is waited for.
	async #loadDriveMedia(device: HostUsbDevice, {wait = false} = {}) {
		const deadline = Date.now() + (wait ? USB_DRIVE_RELEASE_TIMEOUT_MS : 0)
		let drive = await usbDriveDisks(device)
		while (drive && drive.disks.length === 0 && Date.now() < deadline) {
			await delay(250)
			drive = await usbDriveDisks(device)
		}
		for (const disk of drive?.withoutMedium ?? []) {
			await execa('eject', ['--trayclose', `/dev/${disk}`]).catch((error) =>
				this.logger.error(`Failed loading the medium of ${disk}`, error),
			)
		}
	}

	// The plugged in devices assigned to a machine
	async #pluggedInUsbDevices(id: string) {
		const bindings = resolveUsbAssignments(this.#usbAssignments(await this.#store.list()), await listHostUsbDevices())
		return bindings.flatMap(({machineId, device}) => (machineId === id && device ? [device] : []))
	}

	// Plugged in devices assigned to a machine, by sysfs path. The host leaves
	// them alone even while their machine is off, so a drive isn't mounted in
	// Files every time its machine lets go of it.
	async reservedUsbDevicePaths() {
		const assignments = this.#usbAssignments(await this.#store.list())
		if (assignments.length === 0) return []
		// A drive whose disks the host is still reading counts as the machine's
		// until it turns out to be a look-alike, so Files never mounts the real one
		const devices = (await listHostUsbDevices()).map((device) => ({...device, disksPending: false}))
		return resolveUsbAssignments(assignments, devices).flatMap(({device}) => (device ? [device.sysfsPath] : []))
	}

	// The plugged in devices this machine should have, with the assignment each
	// one is. A device the machine was given wins over apps using it through a
	// driver, a network connection the host can manage without, and Files, which
	// can only have mounted the drive just as the machine was given it. Anything
	// else the host is using is left alone and looked at again shortly.
	// Devices already attached to it are kept as they are, since QEMU itself
	// holds them open.
	async #usbDevicesToAttach(definition: MachineDefinition, attached: UsbAddress[] = []) {
		if (!definition.usbDevices?.length) return []
		const devices = await listHostUsbDevices()
		// A drive that could be one of this machine's, but whose disks the host is
		// still setting up, is looked at again on the next poll
		const pending = devices.some(
			(device) =>
				device.disksPending &&
				definition.usbDevices!.some(({port, serial}) => device.port === port || (!!serial && device.serial === serial)),
		)
		if (pending) this.#usbRetryAt ??= Date.now()
		const bindings = resolveUsbAssignments(this.#usbAssignments(await this.#store.list()), devices)
			.filter((binding) => binding.machineId === definition.id)
			.flatMap(({assignment, device}) => (device ? [{assignment, device}] : []))
		const hostUses = await this.#usbHostUses(
			bindings
				.map(({device}) => device)
				.filter((device) => !attached.some((address) => sameUsbAddress(address, device))),
		)
		const blocked = new Set<HostUsbDevice>()
		const notices = new Set<string>()
		for (const [device, hostUse] of hostUses) {
			const description = `USB device ${device.vendorId}:${device.productId} on ${device.port}`
			if (hostUse.takeable) {
				const from = hostUse.apps ? hostUse.apps.map(({id}) => id).join(', ') : `Umbrel's ${hostUse.reason}`
				notices.add(`Taking ${description} from ${from} for ${definition.id}`)
				const ejected = await this.#ejectDrives(hostUse.disks ?? []).then(
					() => true,
					(error) => {
						this.logger.error(`Failed ejecting ${description} for ${definition.id}`, error)
						return false
					},
				)
				if (ejected) continue
			}
			blocked.add(device)
			notices.add(`Not passing ${description} to ${definition.id} while Umbrel is using it (${hostUse.reason})`)
		}
		const previous = this.#usbNotices.get(definition.id)
		for (const notice of notices) if (!previous?.has(notice)) this.logger.log(notice)
		this.#usbNotices.set(definition.id, notices)
		if (blocked.size > 0) this.#usbRetryAt ??= Date.now() + USB_RETRY_INTERVAL_MS
		const given = bindings.filter(({device}) => !blocked.has(device))
		for (const {device} of given) {
			if (!attached.some((address) => sameUsbAddress(address, device))) await this.#loadDriveMedia(device)
		}
		return given
	}

	// Bring a running machine's passed-through devices in line with its
	// assignments and what is plugged in. Callers hold the machine lock.
	async #reconcileUsbDevices(id: string) {
		if ((await this.#libvirt.state(id)) !== 'running') return
		await this.#followReenumeratedUsbDevices(id)
		const attached = await this.#libvirt.attachedUsbDevices(id)
		const wanted = (await this.#usbDevicesToAttach(await this.#definition(id), attached)).map(
			({assignment, device}) => ({address: {bus: device.bus, device: device.device}, port: device.port, assignment}),
		)
		for (const address of attached) {
			if (wanted.some((other) => sameUsbAddress(other.address, address))) continue
			await this.#libvirt
				.detachUsbDevice(id, address)
				.catch((error) =>
					this.logger.error(`Failed detaching USB device ${address.bus}:${address.device} from ${id}`, error),
				)
		}
		for (const {address} of wanted) {
			if (attached.some((other) => sameUsbAddress(other, address))) continue
			await this.#libvirt
				.attachUsbDevice(id, address)
				.catch((error) =>
					this.logger.error(`Failed attaching USB device ${address.bus}:${address.device} to ${id}`, error),
				)
		}
		this.#usbAttached.set(id, wanted)
	}

	// Follow a device that disconnected from a running machine and came straight
	// back in the same port as a different model. A USB NPU like the Coral does
	// this once its driver loads firmware onto it, and would otherwise vanish
	// from the guest at that point. The new model is remembered with the
	// assignment, so the machine keeps the device in either form, across
	// restarts too. Callers hold the machine lock.
	async #followReenumeratedUsbDevices(id: string) {
		const now = Date.now()
		const devices = await listHostUsbDevices()
		const departed = (this.#usbDeparted.get(id) ?? []).filter(({at}) => now - at < USB_REENUMERATION_WINDOW_MS)
		for (const {address, port, assignment} of this.#usbAttached.get(id) ?? []) {
			if (!devices.some((device) => sameUsbAddress(device, address))) departed.push({port, assignment, at: now})
		}
		// Only devices that disconnect from now on count as departing anew
		this.#usbAttached.delete(id)
		this.#usbDeparted.delete(id)
		if (departed.length === 0) return

		const definition = await this.#definition(id)
		const bindings = resolveUsbAssignments(this.#usbAssignments(await this.#store.list()), devices)
		const waiting: typeof departed = []
		let followed = false
		for (const entry of departed) {
			const assignment = definition.usbDevices?.find((assignment) => sameUsbDevice(assignment, entry.assignment))
			const back = bindings.some(
				(binding) => binding.machineId === id && binding.device && sameUsbDevice(binding.assignment, entry.assignment),
			)
			// It's no longer assigned, or it came back as a model it's known by
			if (!assignment || back) continue
			const replacement = usbDeviceReplacing(entry.port, devices, bindings)
			if (!replacement) {
				waiting.push(entry)
				continue
			}
			const {vendorId, productId, serial} = replacement
			assignment.aliases = [...(assignment.aliases ?? []), {vendorId, productId, ...(serial ? {serial} : {})}].slice(
				-MAX_MACHINE_USB_DEVICE_ALIASES,
			)
			followed = true
			this.logger.log(
				`Following USB device ${assignment.vendorId}:${assignment.productId} on ${entry.port}, which came back as ${vendorId}:${productId}, for ${id}`,
			)
		}
		if (waiting.length > 0) this.#usbDeparted.set(id, waiting)
		if (!followed) return
		await this.#store.write(definition)
		await this.#syncUsbReservations()
	}

	#forgetUsbDevices(id: string) {
		this.#usbNotices.delete(id)
		this.#usbAttached.delete(id)
		this.#usbDeparted.delete(id)
	}

	// Have the host's own services leave the devices assigned to machines
	// alone. See usbReservationRules for what that covers. udev applies rules as
	// devices are plugged in, so devices already plugged in whose reservation
	// changed are told to apply them again. That has udev probe them afresh,
	// which holds a drive open for a moment, so wait for it to finish before a
	// machine is given the device.
	async #syncUsbReservations() {
		const bindings = resolveUsbAssignments(this.#usbAssignments(await this.#store.list()), await listHostUsbDevices())
		const rules = usbReservationRules(bindings)
		if (rules === this.#usbReservation?.rules) return
		const paths = bindings.flatMap(({device}) => (device ? [device.sysfsPath] : []))
		// Nothing to undo either, as on most Umbrels
		if (!rules && !(await fse.pathExists(USB_RESERVATION_RULES_PATH))) {
			this.#usbReservation = {rules, paths}
			return
		}
		const previous = this.#usbReservation?.paths
		// When umbreld has only just started, it can't tell what changed
		const changed = previous
			? [...paths.filter((path) => !previous.includes(path)), ...previous.filter((path) => !paths.includes(path))]
			: paths
		try {
			if (rules) await fse.outputFile(USB_RESERVATION_RULES_PATH, rules)
			else await fse.remove(USB_RESERVATION_RULES_PATH)
			await execa('udevadm', ['control', '--reload'])
			if (changed.length > 0) {
				await execa(
					'udevadm',
					['trigger', '--settle', '--action=change', ...changed.flatMap((path) => ['--parent-match', path])],
					{timeout: 30_000},
				)
			}
			this.#usbReservation = {rules, paths}
		} catch (error) {
			this.logger.error('Failed updating which USB devices the host leaves alone', error)
		}
	}

	#requestUsbReconcile() {
		// A pass that hasn't started yet already covers this change
		if (this.#usbReconcileQueue.size > 0) return
		void this.#usbReconcileQueue.add(async () => {
			// A device followed to another port by its serial number moves its
			// reservation with it
			await this.#syncUsbReservations()
			for (const {id, usbDevices} of await this.#store.list()) {
				if (!usbDevices?.length) continue
				await this.#withMachineLock(id, () => this.#reconcileUsbDevices(id)).catch((error) =>
					this.logger.error(`Failed updating USB devices for ${id}`, error),
				)
			}
		})
	}

	// Every USB device plugged into Umbrel, with what each machine is assigned
	async usbDevices(): Promise<MachineUsbDevice[]> {
		const definitions = await this.#store.list()
		const devices = (await listHostUsbDevices()).filter((device) => !device.hub)
		const bindings = resolveUsbAssignments(this.#usbAssignments(definitions), devices)
		// QEMU holds the devices it has, so only check the rest for host use
		const attached = (
			await Promise.all(
				definitions.map(async ({id}) => {
					if (!this.#libvirt.available) return []
					const state = await this.#libvirt.state(id).catch(() => 'stopped')
					return state === 'running' ? this.#libvirt.attachedUsbDevices(id) : []
				}),
			)
		).flat()
		const hostUses = await this.#usbHostUses(
			devices.filter((device) => !attached.some((address) => sameUsbAddress(address, device))),
		)
		const describeHostUse = (device: HostUsbDevice): MachineUsbHostUse | undefined => {
			const hostUse = hostUses.get(device)
			return hostUse && {reason: hostUse.reason, apps: hostUse.apps, takeable: hostUse.takeable}
		}
		return [
			...devices.map((device) => {
				const binding = bindings.find((binding) => binding.device === device)
				// An assigned device keeps its assigned identity, even after moving port
				const {vendorId, productId, serial, port} = binding?.assignment ?? device
				return {
					vendorId,
					productId,
					serial,
					port,
					// and the name it was assigned under. A drive's label can only be read
					// while the host has the drive.
					name: binding?.assignment.name ?? device.name,
					manufacturer: device.manufacturer,
					connected: true,
					machineId: binding?.machineId,
					hostUse: describeHostUse(device),
				}
			}),
			...bindings
				.filter((binding) => !binding.device)
				.map(({machineId, assignment}) => ({...assignment, connected: false, machineId})),
		]
	}

	async setPinned(id: string, pinned: boolean) {
		return this.#withMachineLock(id, async () => {
			this.#assertBackupIdle(id)
			const definition = await this.#definition(id)
			definition.pinned = pinned
			await this.#store.write(definition)
			await this.#emitMachines()
			return true
		})
	}

	async ejectInstallMedia(id: string) {
		return this.#withMachineLock(id, async () => {
			this.#assertBackupIdle(id)
			const definition = await this.#definition(id)
			if (!definition.installMedia && !definition.bootMedia) return true
			// Managed catalog installs remove their media automatically after the
			// authenticated guest callback. Do not let a user interrupt that setup.
			if (definition.firstBootSetup) throw new Error('[machine-first-boot-setup-in-progress]')
			if ((await this.#libvirt.state(id)) !== 'stopped') await this.#libvirt.ejectInstallMedia(definition)

			const mediaPaths = [definition.installMedia, definition.seedMedia, definition.bootMedia]
				.filter((path): path is string => !!path)
				.map((path) => nodePath.join(this.#store.directory(id), path))
			if (definition.installMedia) {
				delete definition.installMedia
			}
			if (definition.bootMedia) {
				delete definition.bootMedia
			}
			delete definition.seedMedia
			await this.#store.write(definition)
			await Promise.all(mediaPaths.map((path) => fse.remove(path)))
			await this.#emitMachines()
			return true
		})
	}

	#backupJournalPath(id: string) {
		return nodePath.join(this.#store.directory(id), 'operations', 'backup.yaml')
	}

	async #syncFile(path: string) {
		const handle = await fsp.open(path, 'r')
		try {
			await handle.sync()
		} finally {
			await handle.close()
		}
	}

	async #syncDirectory(path: string) {
		const handle = await fsp.open(path, 'r')
		try {
			await handle.sync()
		} finally {
			await handle.close()
		}
	}

	async #syncTree(path: string) {
		const stat = await fsp.lstat(path)
		if (stat.isFile()) return this.#syncFile(path)
		if (!stat.isDirectory()) return
		for (const entry of await fsp.readdir(path)) await this.#syncTree(nodePath.join(path, entry))
		await this.#syncDirectory(path)
	}

	async #writeBackupJournal(journal: BackupJournal) {
		const path = this.#backupJournalPath(journal.machineId)
		const temporary = `${path}.${process.pid}.tmp`
		const handle = await fsp.open(temporary, 'w', 0o600)
		try {
			await handle.writeFile(yaml.dump(journal), 'utf8')
			await handle.sync()
		} finally {
			await handle.close()
		}
		await fsp.rename(temporary, path)
		await this.#syncDirectory(nodePath.dirname(path))
	}

	async #removeBackupJournal(id: string) {
		const path = this.#backupJournalPath(id)
		await fse.remove(path)
		await this.#syncDirectory(nodePath.dirname(path))
	}

	async #readBackupJournal(id: string) {
		const path = this.#backupJournalPath(id)
		return yaml.load(await fsp.readFile(path, 'utf8')) as BackupJournal
	}

	async #prepareMachineBackup(definition: MachineDefinition) {
		// External disks are explicitly outside the Umbrel data backup. The
		// portable machine definition is still backed up and can reattach the disk
		// when its drive/share is available again.
		if (definition.diskPath) return false
		if ((await this.#libvirt.state(definition.id)) !== 'running') return false
		const operations = nodePath.join(this.#store.directory(definition.id), 'operations')
		await fse.ensureDir(operations)
		await execa('chown', ['libvirt-qemu:libvirt-qemu', operations])
		const journal: BackupJournal = {
			version: 1,
			machineId: definition.id,
			phase: 'preparing',
			overlay: nodePath.join(operations, `backup-overlay-${randomUUID()}.qcow2`),
		}
		await this.#writeBackupJournal(journal)
		this.#backupMachines.add(definition.id)

		await this.#libvirt.pause(definition.id)
		try {
			await this.#libvirt.pivotToBackupOverlay(definition, journal.overlay)
			await this.#syncDirectory(operations)
			const nvram = nodePath.join(this.#store.directory(definition.id), 'nvram.fd')
			if (await fse.pathExists(nvram)) {
				const frozen = nodePath.join(operations, 'backup-nvram-frozen.fd')
				journal.nvramLive = nodePath.join(operations, 'backup-nvram-live.fd')
				await fse.copy(nvram, frozen, {overwrite: true})
				await this.#syncFile(frozen)
				// Persist the recovery path before moving the live inode. An abrupt
				// reboot between either rename can then still restore a valid NVRAM.
				await this.#writeBackupJournal(journal)
				await fsp.rename(nvram, journal.nvramLive)
				await this.#syncDirectory(nodePath.dirname(nvram))
				await fsp.rename(frozen, nvram)
				await this.#syncDirectory(nodePath.dirname(nvram))
			}
			const tpm = nodePath.join(this.#store.directory(definition.id), 'tpm')
			if (await fse.pathExists(tpm)) {
				const frozen = nodePath.join(operations, 'backup-tpm-frozen')
				journal.tpmLive = nodePath.join(operations, 'backup-tpm-live')
				await fse.remove(frozen)
				await fse.copy(tpm, frozen)
				await this.#syncTree(frozen)
				await this.#writeBackupJournal(journal)
				await fsp.rename(tpm, journal.tpmLive)
				await this.#syncDirectory(nodePath.dirname(tpm))
				await fsp.rename(frozen, tpm)
				await this.#syncDirectory(nodePath.dirname(tpm))
			}
			journal.phase = 'pivoted'
			await this.#writeBackupJournal(journal)
		} catch (error) {
			try {
				if (await fse.pathExists(journal.overlay)) await this.#libvirt.commitBackupOverlay(definition, journal.overlay)
				if (journal.nvramLive && (await fse.pathExists(journal.nvramLive))) {
					const nvram = nodePath.join(this.#store.directory(definition.id), 'nvram.fd')
					await fse.move(journal.nvramLive, nvram, {
						overwrite: true,
					})
					await this.#syncFile(nvram)
					await this.#syncDirectory(nodePath.dirname(nvram))
				}
				if (journal.tpmLive && (await fse.pathExists(journal.tpmLive))) {
					const tpm = nodePath.join(this.#store.directory(definition.id), 'tpm')
					await fse.move(journal.tpmLive, tpm, {
						overwrite: true,
					})
					await this.#syncTree(tpm)
					await this.#syncDirectory(nodePath.dirname(tpm))
				}
				await fse.remove(journal.overlay)
				await this.#syncDirectory(nodePath.dirname(journal.overlay))
				await this.#removeBackupJournal(definition.id)
				this.#backupMachines.delete(definition.id)
			} catch (rollbackError) {
				this.logger.error(`Failed rolling back backup preparation for ${definition.id}`, rollbackError)
			}
			throw error
		} finally {
			await this.#libvirt.resume(definition.id)
		}
		return true
	}

	async #releaseMachineBackup(definition: MachineDefinition) {
		const journal = await this.#readBackupJournal(definition.id)
		journal.phase = 'committing'
		await this.#writeBackupJournal(journal)
		if (await fse.pathExists(journal.overlay)) await this.#libvirt.commitBackupOverlay(definition, journal.overlay)

		const state = await this.#libvirt.state(definition.id)
		const shouldResume = state === 'running'
		if (shouldResume) await this.#libvirt.pause(definition.id)
		let released = false
		try {
			if (journal.nvramLive && (await fse.pathExists(journal.nvramLive))) {
				await fse.move(journal.nvramLive, nodePath.join(this.#store.directory(definition.id), 'nvram.fd'), {
					overwrite: true,
				})
				await this.#syncFile(nodePath.join(this.#store.directory(definition.id), 'nvram.fd'))
				await this.#syncDirectory(this.#store.directory(definition.id))
			}
			if (journal.tpmLive && (await fse.pathExists(journal.tpmLive))) {
				await fse.move(journal.tpmLive, nodePath.join(this.#store.directory(definition.id), 'tpm'), {
					overwrite: true,
				})
				await this.#syncTree(nodePath.join(this.#store.directory(definition.id), 'tpm'))
				await this.#syncDirectory(this.#store.directory(definition.id))
			}
			await fse.remove(journal.overlay)
			await this.#syncDirectory(nodePath.dirname(journal.overlay))
			await this.#removeBackupJournal(definition.id)
			released = true
		} finally {
			try {
				if (shouldResume) await this.#libvirt.resume(definition.id)
			} finally {
				// A failed commit or state restoration leaves the journal as the only
				// recovery authority. Keep this machine blocked until a later release or
				// startup recovery succeeds instead of allowing destructive lifecycle work.
				if (released) this.#backupMachines.delete(definition.id)
			}
		}
	}

	async #recoverInterruptedBackups({strict = false} = {}) {
		const failures: unknown[] = []
		for (const definition of await this.#store.list()) {
			if (!(await fse.pathExists(this.#backupJournalPath(definition.id)))) continue
			this.logger.log(`Recovering interrupted backup for ${definition.id}`)
			this.#backupMachines.add(definition.id)
			await this.#withMachineLock(definition.id, () => this.#releaseMachineBackup(definition)).catch((error) => {
				failures.push(error)
				this.logger.error(`Failed to recover machine backup ${definition.id}`, error)
			})
		}
		if (strict && failures.length > 0) throw new AggregateError(failures, '[machine-backup-recovery-failed]')
	}

	// Freeze running machine disks and firmware state into their canonical
	// paths while writes continue in ignored external overlays. Kopia can then
	// snapshot the whole Umbrel data directory without torn VM state.
	async prepareBackup() {
		if (!this.#libvirt.available) return true
		if (this.#backupActive) throw new Error('[machine-backup-already-running]')
		this.#backupActive = true
		const prepared: MachineDefinition[] = []
		try {
			// A prior release may have failed after QEMU pivoted to its overlay.
			// Recover that transaction before creating any new snapshot state.
			await this.#recoverInterruptedBackups({strict: true})
			for (const definition of await this.#store.list()) {
				await this.#withMachineLock(definition.id, async () => {
					// Reload the definition under the per-machine lifecycle lock before
					// freezing its canonical state.
					const current = await this.#definition(definition.id)
					if (await this.#prepareMachineBackup(current)) prepared.push(current)
				})
			}
			return true
		} catch (error) {
			for (const definition of prepared.reverse()) {
				await this.#withMachineLock(definition.id, () => this.#releaseMachineBackup(definition)).catch((releaseError) =>
					this.logger.error(`Failed rolling back backup preparation for ${definition.id}`, releaseError),
				)
			}
			this.#backupActive = false
			throw error
		}
	}

	async releaseBackup() {
		if (!this.#libvirt.available) {
			if (!this.#backupActive) return
			this.#backupActive = false
			throw new Error('[virtualization-unavailable]')
		}
		const failures: unknown[] = []
		try {
			for (const definition of await this.#store.list()) {
				try {
					await this.#withMachineLock(definition.id, async () => {
						if (await fse.pathExists(this.#backupJournalPath(definition.id))) {
							await this.#releaseMachineBackup(await this.#definition(definition.id))
						}
					})
				} catch (error) {
					failures.push(error)
					this.logger.error(`Failed releasing machine backup ${definition.id}`, error)
				}
			}
		} finally {
			this.#backupActive = false
		}
		if (failures.length > 0) throw new AggregateError(failures, '[machine-backup-release-failed]')
	}
}
