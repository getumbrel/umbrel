# umbrelOS

## GPU acceleration

The amd64 image keeps GPU userspace in application containers while providing
the host kernel interfaces those runtimes require:

| Hardware/backend | Host support | Container support |
| --- | --- | --- |
| AMD Vulkan | In-tree `amdgpu`, `/dev/dri` | Mesa/RADV |
| AMD ROCm | In-tree `amdgpu`/KFD, `/dev/kfd` and `/dev/dri` | ROCm/HIP |
| NVIDIA Vulkan | NVIDIA open kernel module, Vulkan ICD, NVIDIA Container Toolkit | Vulkan application/runtime |
| NVIDIA CUDA | NVIDIA open kernel module, `libcuda`, NVIDIA Container Toolkit | CUDA runtime |
| NVIDIA video | NVIDIA open kernel module, NVDEC/NVENC libraries, NVIDIA Container Toolkit | Video application/runtime |

NVIDIA's Vulkan, CUDA, and video implementations share the NVIDIA kernel driver
and can be used simultaneously. They coexist with AMDGPU and RADV on mixed-GPU
systems; the Vulkan loader selects the ICD matching each device. Containers
using NVIDIA Vulkan must request the `graphics` NVIDIA driver capability,
expose `/dev/dri`, and include the Vulkan and GLVND EGL loaders (`libvulkan1`
and `libegl1` on Debian-based images). Containers using NVDEC or NVENC must
request the `video` NVIDIA driver capability and include a compatible video
application such as FFmpeg.

An image that only needs Vulkan acceleration on NVIDIA hardware can set the
`NVIDIA_CUDA_SUPPORT=false` build argument to omit the NVIDIA host packages and
use the in-tree `nouveau` driver with containerized Mesa/NVK instead. NVK cannot
drive a GPU while that GPU is bound to the NVIDIA kernel driver.


## NVIDIA kernel compatibility

`patches/nvidia-pci-resize.patch` is copied unchanged from Debian's
`nvidia-open-gpu-kernel-modules` **550.163.01-4.1** packaging, fixing the
[PCI resize API incompatibility](https://bugs.debian.org/1143204) introduced in
Linux 6.12.100. Attribution is retained in the patch; its third-party license
is in `patches/nvidia-pci-resize.LICENSE`.

The source archive's SHA256 is
`2a8c66934e00e901e7ea9fb63eebf9b82beb7c0fcb3cfc48523fc3521aaf6b07`,
verified against Debian's signed sid source index. The exact patch SHA256 is
`0b296d1e884cfe9c2643f98acbda80b3daf60e32de771b43fd2404d3ced4691b`.
Source: <https://deb.debian.org/debian/pool/contrib/n/nvidia-open-gpu-kernel-modules/nvidia-open-gpu-kernel-modules_550.163.01-4.1.debian.tar.xz>.

The amd64/CUDA image-build branch unpacks the existing snapshot's
`nvidia-open-kernel-dkms=550.163.01-2`, applies this patch, then configures the
package and builds its modules. The helper rejects version drift and repeated
execution. NVIDIA userspace and the OS-wide snapshot remain unchanged; no
unavailable -4.1 binary package is assumed. Do not run the helper on a deployed
appliance.

The native amd64 workflow builds the base with default drivers and checks the
installed kernel, headers, initramfs, ZFS and NVIDIA module. It is not a full OS
image, OTA, or physical GPU test.

## Generic Debian kernel updates

The generic amd64 and arm64 base images install a checksummed set of signed
Debian trixie-security kernel packages independently of `APT_SNAPSHOT_DATE`.
`LINUX_VERSION=6.12.113-1` includes the fix for
[CVE-2026-98432](https://security-tracker.debian.org/tracker/CVE-2026-98432).
This does not update a running device; a rebuilt OS image/update bundle must
be released, installed and booted. Raspberry Pi images use the Raspberry Pi
archive kernels configured in `build-steps/setup-raspberrypi.sh`, not this set.

When updating the kernel, update `LINUX_VERSION`, `LINUX_SNAPSHOT_DATE` and
`linux-packages.sha256` together. Obtain the filenames and SHA256 values from
the snapshot's authenticated `trixie-security/main/binary-{amd64,arm64}/Packages`
indices. Include both architectures' image and header meta-packages, signed
images, matching headers and kbuild, plus their shared common headers. Keep
unrelated dependencies on the existing OS-wide APT snapshot.

Verify the manifest offline with Python 3 (standard library only), `sqv` with
cleartext verification support, and a trusted Debian archive keyring installed
independently of the downloaded metadata (Debian's `debian-archive-keyring`
package). Download public metadata into this layout first:

```sh
# Run from the repository root. Match LINUX_SNAPSHOT_DATE in umbrelos.Dockerfile.
snapshot=20261031T000000Z
metadata=linux-metadata
base="https://snapshot.debian.org/archive/debian-security/${snapshot}/dists/trixie-security"
mkdir -p "${metadata}"
curl -fsSL "${base}/InRelease" -o "${metadata}/InRelease"
for arch in amd64 arm64; do
  mkdir -p "${metadata}/main/binary-${arch}"
  curl -fsSL "${base}/main/binary-${arch}/Packages.xz" \
    -o "${metadata}/main/binary-${arch}/Packages.xz"
done
python3 packages/os/tools/verify-linux-manifest.py "${metadata}" \
  --keyring /usr/share/keyrings/debian-archive-keyring.gpg
```

The verifier performs no downloads. Manifest and Dockerfile paths default to
this package's files, relative to the script, not the working directory.
`--version`, `--snapshot` and `--codename` default to the Dockerfile's
`LINUX_VERSION`, `LINUX_SNAPSHOT_DATE` and `DEBIAN_VERSION` + `-security`;
`--manifest` and `--dockerfile` allow checking candidate replacements.

Only the authenticated release body emitted by `sqv` is parsed. The verifier
checks Debian security identity, codename and signed release validity at the
selected snapshot time, then SHA256 and size for both compressed indices,
then every manifest entry's SHA256, version and architecture. Shared `all`
packages must match both indices. This checks provenance of listed packages,
not dependency completeness or downloaded `.deb` contents (the build checks
those against the manifest). Snapshot URLs/timestamps are not signed: the
validity-window check does not prove which snapshot served the metadata.
Historical metadata need not still be within `Valid-Until` today.

Build and check the kernel-bearing base stage for each architecture:

```sh
docker build --platform=linux/arm64 --target=umbrelos-base \
  -f packages/os/umbrelos.Dockerfile -t umbrelos-kernel-test:arm64 .
docker run --rm -i --platform=linux/arm64 umbrelos-kernel-test:arm64 \
  bash < packages/os/tests/kernel.test.sh
```

Repeat with `amd64`. The test checks installed package versions, matching
headers, initramfs generation and ZFS DKMS output without loading modules.
The amd64 build also exercises the default NVIDIA and Realtek DKMS packages.
Full image packaging, boot and hardware validation remain separate gates.

## Build Process

The following diagram visualizes the build process and possible build artifacts:

```mermaid
graph TD
    subgraph "Docker"
        root-amd64
        root-arm64
    end
    subgraph "Rugix (Pi)"
        pi --> pi4
        pi --> pi-tryboot
        pi --> pi-mbr
    end
    subgraph "Rugix (AMD64)"
        amd64
        mender-amd64
    end
    root-amd64 --> amd64
    root-amd64 --> mender-amd64
    root-arm64 --> pi
    amd64 --> amd64-img([amd64.img])
    amd64 --> amd64-rugixb([amd64.rugixb])
    mender-amd64 --> mender-amd64-mender([mender-amd64.mender])
    mender-amd64 --> mender-amd64-rugixb([mender-amd64.rugixb])
    pi-mbr --> pi-mbr-mender([pi.mender])
    pi4 --> pi4-img([pi4.img])
    pi-tryboot --> pi-tryboot-img([pi.img])
    pi-tryboot --> pi-tryboot-rugixb([pi.rugixb])
```

### OS Variants

There are three main umbrelOS *variants*:

- `umbrelos-pi`: Rugix-native umbrelOS for Raspberry Pi.
- `umbrelos-amd64`: Rugix-native umbrelOS for AMD64.
- `umbrelos-mender-amd64`: Rugix-based but Mender-compatible umbrelOS for AMD64.

> [!IMPORTANT]
> **Legacy devices provisioned with Mender require the `umbrelos-mender-amd64` variant.** This variant includes a Rugix configuration to enable a safe migration from Mender to Rugix. Rugix will interface with GRUB in the same way Mender does to facilitate A/B switching. In addition, a Rugix hook is installed to migrate state into Rugix's state management mechanism. This enables factory resets and all other Rugix state management features.

### Build Artifacts

The build process can produce the following artifacts.

#### Images

Images for provisioning new umbrelOS devices.

- `umbrelos-amd64.img`: Image for provisioning AMD64 devices and VMs.
- `umbrelos-pi.img`: Image for provisioning Raspberry Pi devices (GPT-based).
- `umbrelos-pi4.img`: Optional image for provisioning Raspberry Pi 4 devices (GPT-based).

The image for Raspberry Pi 4 includes a firmware update to enable the `tryboot` mechanism used for A/B switching. Otherwise, the image is identical to the image for Raspberry Pi 5.

#### Mender Update Artifacts

Optional Mender update artifacts for updating existing systems through Mender:

- `umbrelos-pi.mender`: Mender update artifact for Raspberry Pi.
- `umbrelos-mender-amd64.mender`: Mender update artifact for AMD64 devices.

The update artifact for Raspberry Pi works for Raspberry Pi 4 and 5.

#### Rugix Update Bundles

For each of the umbrelOS variants, there is a respective Rugix update bundle:

- `umbrelos-pi.rugixb`: Rugix update bundle for Raspberry Pi.
- `umbrelos-amd64.rugixb`: Rugix update bundle for Rugix-native AMD64 devices.
- `umbrelos-mender-amd64.rugixb`: Rugix update bundle for legacy Mender devices.


## Mender to Rugix Migration

Devices can be migrated to Rugix by installing the respective Mender update artifact.

### Raspberry Pi

As umbrelOS for Raspberry Pi has always been based on Rugix, no special migration is needed.

### AMD64

In case of Mender-based AMD64 devices, the directory structure on the data partition must be migrated such that Rugix's state management can be used.
This migration is performed by a `boot/post-init` Rugix hook: [`10-migrate-state.sh`](./rugix/recipes/setup-rugix-mender/files/migrate-state.sh).
This hook works as follows: Initially, a symlink `/data/umbrel-os` is placed in the `/data` directory managed by Rugix linking back to the bare data partition.
This way, after booting, all the bind mounts to `/data/umbrel-os` are set up correctly.
The migration hook replaces this symlink atomically with the directory from the data partition, **but only after the system has been committed**.
This is done to leave the state intact, in case there is a rollback.
Note that the system needs to be rebooted once after the commit to trigger the migration.
To this end, after committing, `umbreld` may check whether `/data/umbrel-os` is a symlink and reboot the system if it is.


## Factory Resets

Factory resets can be triggered through Rugix Ctrl's state management mechanism as usual.
To trigger a factory reset, run `rugix-ctrl state reset`.
This will reboot the system and remove the state on the data partition in the process.
In case of a RAID configuration, a [`state-reset/prepare` hook](./rugix/recipes/setup-rugix/files/factory-reset.sh) is used to remove the RAID configuration and reset the main data partition.
Note that Rugix only supports resetting the state on the actively used data partition (which is the RAID, if a RAID has been configured), hence, we need to use the hook here to make sure that the main data partition is wiped as well.

Removing state can take some time during the boot process.
It is therefore recommended to use Rugix's state reset mechanism with the `--backup` flag.
This will simply rename the old state directory according to the following pattern:

```
/run/rugix/mounts/data/state/default -> /run/rugix/mounts/data/state/default.XXXXXXXXXXXXXX
```

Here, `XXXXXXXXXXXXXX` is the date and time of the reset.
The residual state can then removed after booting by `umbreld`.
