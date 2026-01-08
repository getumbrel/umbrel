#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$SCRIPT_DIR/vm-state"

function err() {
    echo "ERROR: $*" >&2
    exit 1
}

function usage() {
  cat >&2 <<USAGE
Usage:
  $0 boot <image>    Boot a VM from the given image
  $0 reset           Delete all VM state (overlay, NVMe disks)

Optional environment variables:
  VM_MEMORY=2048        # RAM in MiB
  VM_CORES=4            # CPU cores
  VM_DISK=64G           # Disk size
  VM_NVME_COUNT=2       # Number of NVMe devices (0-4)
  LOCAL_SSH_PORT=2222   # Local port for SSH
  LOCAL_HTTP_PORT=8080  # Local port for HTTP
  QEMU_ARGS             # Additional arguments for QEMU
USAGE
  exit 2
}

[[ $# -lt 1 ]] && usage

COMMAND="$1"
shift

case "$COMMAND" in
  reset)
    if [[ -d "$STATE_DIR" ]]; then
      echo "Removing VM state directory: $STATE_DIR"
      rm -rf "$STATE_DIR"
      echo "Done."
    else
      echo "No state to reset."
    fi
    exit 0
    ;;
  boot)
    [[ $# -lt 1 ]] && usage
    IMAGE="$1"
    ;;
  *)
    usage
    ;;
esac

VM_MEMORY=${VM_MEMORY:-2048}
VM_CORES=${VM_CORES:-4}
VM_DISK=${VM_DISK:-64G}
VM_NVME_COUNT=${VM_NVME_COUNT:-2}

RAID_DISK_SIZE=${RAID_DISK:-64G}

LOCAL_SSH_PORT=${LOCAL_SSH_PORT:-2222}
LOCAL_HTTP_PORT=${LOCAL_HTTP_PORT:-8080}

# Auto-detect OVMF firmware paths if not set
if [[ -z "${OVMF_CODE:-}" ]]; then
  if [[ -f "/opt/homebrew/share/qemu/edk2-x86_64-code.fd" ]]; then
    OVMF_CODE="/opt/homebrew/share/qemu/edk2-x86_64-code.fd"
    OVMF_VARS_TEMPLATE="/opt/homebrew/share/qemu/edk2-i386-vars.fd"
  elif [[ -f "/usr/local/share/qemu/edk2-x86_64-code.fd" ]]; then
    OVMF_CODE="/usr/local/share/qemu/edk2-x86_64-code.fd"
    OVMF_VARS_TEMPLATE="/usr/local/share/qemu/edk2-i386-vars.fd"
  elif [[ -f "/usr/share/OVMF/OVMF_CODE_4M.fd" ]]; then
    OVMF_CODE="/usr/share/OVMF/OVMF_CODE_4M.fd"
    OVMF_VARS_TEMPLATE="/usr/share/OVMF/OVMF_VARS_4M.fd"
  else
    err "OVMF firmware not found. On macOS: brew install qemu"
  fi
fi

[[ -f "$IMAGE" ]] || err "image not found: $IMAGE"

command -v qemu-img >/dev/null 2>&1 || err "'qemu-img' not found in PATH"
command -v qemu-system-x86_64 >/dev/null 2>&1 || err "'qemu-system-x86_64' not found in PATH"

mkdir -p "$STATE_DIR"

# Copy OVMF VARS to state dir for writable UEFI NVRAM
OVMF_VARS="$STATE_DIR/ovmf-vars.fd"
if [ ! -f "$OVMF_VARS" ]; then
  cp "$OVMF_VARS_TEMPLATE" "$OVMF_VARS"
fi

OVERLAY="$STATE_DIR/overlay.qcow2"

if [ ! -f "$OVERLAY" ]; then
  echo "Creating overlay image..."
  IMAGE_ABS="$(cd "$(dirname "$IMAGE")" && pwd)/$(basename "$IMAGE")"
  qemu-img create -f qcow2 -F raw -b "$IMAGE_ABS" "$OVERLAY" "$VM_DISK" >/dev/null
else
  echo "Overlay image already exists."
fi

# Create NVMe disks with PCIe root ports matching Umbrel Pro physical slot numbers so
# SSD slot detection works.
NVME_PCI_SLOTS=(6 4 14 12)  # PCIe Physical Slot Numbers for physical slots 1-4
NVME_ARGS=""
for i in $(seq 1 "$VM_NVME_COUNT"); do
  NVME_DISK="$STATE_DIR/nvme${i}.qcow2"
  if [ ! -f "$NVME_DISK" ]; then
    qemu-img create -f qcow2 "$NVME_DISK" "$RAID_DISK_SIZE" >/dev/null
  fi
  PCI_SLOT="${NVME_PCI_SLOTS[$((i-1))]}"
  # Create a PCIe root port with the correct slot number, then attach NVMe to it
  NVME_ARGS="$NVME_ARGS -device pcie-root-port,id=rp${i},slot=${PCI_SLOT},chassis=${i}"
  NVME_ARGS="$NVME_ARGS -drive file=$NVME_DISK,format=qcow2,if=none,id=nvme${i},cache=none,discard=unmap,aio=threads"
  NVME_ARGS="$NVME_ARGS -device nvme,drive=nvme${i},serial=nvme${i},bus=rp${i}"
done

QEMU_GRAPHICS=${QEMU_GRAPHICS:-"-nographic -monitor none -chardev stdio,id=char0,signal=off -serial chardev:char0"}

# Platform-specific acceleration
case "$(uname -s)" in
  Linux)  ACCEL_ARGS="-enable-kvm -machine accel=kvm,type=q35 -cpu host" ;;
  Darwin)
    if qemu-system-x86_64 -accel help 2>&1 | grep -q hvf; then
      ACCEL_ARGS="-machine accel=hvf,type=q35 -cpu max"
    else
      echo "WARNING: HVF not available, using TCG (slow)" >&2
      ACCEL_ARGS="-machine accel=tcg,type=q35 -cpu max"
    fi
    ;;
  *)      err "Unsupported platform: $(uname -s)" ;;
esac

exec qemu-system-x86_64 \
  $ACCEL_ARGS \
  -smp "$VM_CORES" \
  -m "$VM_MEMORY" \
  -rtc base=utc \
  $QEMU_GRAPHICS \
  -smbios "type=1,manufacturer=Umbrel,, Inc.,product=Umbrel Pro,sku=U4XN1,family=NAS" \
  -drive if=pflash,format=raw,readonly=on,file="$OVMF_CODE" \
  -drive if=pflash,format=raw,file="$OVMF_VARS" \
  -drive file="$OVERLAY",if=none,id=boot,format=qcow2,cache=none,discard=unmap,aio=threads \
  -device virtio-blk-pci,drive=boot,bootindex=0 \
  -netdev user,id=net0,hostfwd=tcp:127.0.0.1:${LOCAL_SSH_PORT}-:22,hostfwd=tcp:127.0.0.1:${LOCAL_HTTP_PORT}-:80 \
  -device virtio-net-pci,netdev=net0 \
  $NVME_ARGS \
  ${QEMU_ARGS:-}
