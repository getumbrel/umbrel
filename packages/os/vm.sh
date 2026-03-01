#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${VM_STATE_DIR:-$SCRIPT_DIR/vm-state}"
NVME_STATE_FILE="$STATE_DIR/nvme.json"
HDD_STATE_FILE="$STATE_DIR/hdd.json"

# Defaults
DEFAULT_DEVICE="umbrel-pro"
DEFAULT_MEMORY=2048
DEFAULT_CORES=4
DEFAULT_DISK_SIZE="64G"
DEFAULT_SSH_PORT=2222
DEFAULT_HTTP_PORT=8080
DEFAULT_NVME_SIZE="64G"
DEFAULT_HDD_SIZE="1T"
MAX_NVME_SLOTS=8
MAX_HDD_SLOTS=8

# Get Umbrel Pro PCIe slot number for an NVMe slot.
# Returns empty if no explicit mapping exists.
get_umbrel_pro_pci_slot() {
  local slot="$1"
  case "$slot" in
    1) echo "12" ;;
    2) echo "14" ;;
    3) echo "4" ;;
    4) echo "6" ;;
    *) echo "" ;;
  esac
}

# Get native architecture in our naming convention (amd64/arm64)
get_native_arch() {
  case "$(uname -m)" in
    x86_64|amd64)
      echo "amd64"
      ;;
    arm64|aarch64)
      echo "arm64"
      ;;
    *)
      echo "amd64"  # Default fallback
      ;;
  esac
}

# Get default image path for an architecture
get_default_image() {
  local arch="$1"
  echo "$SCRIPT_DIR/build/umbrelos-${arch}.img"
}

show_help() {
  cat << EOF
vm.sh - Manage an umbrelOS QEMU virtual machine

Usage: $0 <command> [options]

Commands:
    boot [image]                   Boot VM from the given image (defaults to native arch image)
    reflash                        Delete boot disk overlay (simulates reflashing the OS)
    reset                          Delete all VM state (overlay, NVMe disks, HDDs, UEFI vars)

    nvme list                      List all NVMe devices and their status
    nvme add <slot> [--size SIZE]  Add an NVMe device to slot (1-${MAX_NVME_SLOTS})
    nvme destroy <slot>            Destroy an NVMe device (deletes data)
    nvme connect <slot>            Connect an existing NVMe device to the VM
    nvme disconnect <slot>         Disconnect an NVMe device from the VM
    nvme move <from> <to>          Move an NVMe device from one slot to another

    sata list                      List all SATA slot devices and their status
    sata add <slot> [--size SIZE] [--type hdd|ssd]
                                   Add a SATA HDD/SSD to slot (1-${MAX_HDD_SLOTS})
    sata destroy <slot>            Destroy SATA device (deletes data)
    sata connect <slot>            Connect an existing SATA device to the VM
    sata disconnect <slot>         Disconnect a SATA device from the VM

Boot Options:
    --device <type>                Device to emulate: umbrel-pro, umbrel-home, nas (default: ${DEFAULT_DEVICE})
    --arch <amd64|arm64>           CPU architecture (default: auto-detect from image name)
    --memory <MiB>                 RAM in MiB (default: ${DEFAULT_MEMORY})
    --cores <count>                CPU cores (default: ${DEFAULT_CORES})
    --disk-size <size>             Boot disk size (default: ${DEFAULT_DISK_SIZE})
    --ssh-port <port>              Local SSH port forward (default: ${DEFAULT_SSH_PORT})
    --http-port <port>             Local HTTP port forward (default: ${DEFAULT_HTTP_PORT})

Disk Options:
    --size <size>                  Disk size for nvme/sata add (default: ${DEFAULT_NVME_SIZE} nvme, ${DEFAULT_HDD_SIZE} sata)
    --type <hdd|ssd>               For sata add only: set SATA device type (default: hdd)

Environment Variables:
    VM_STATE_DIR                   Override state directory (default: ./vm-state)

Examples:
    $0 boot                                        # Boot native arch image as Umbrel Pro
    $0 boot --device umbrel-home                   # Boot as Umbrel Home (NVMe boot, no eMMC)
    $0 boot --device nas                           # Boot as generic NAS (8 SSD + 8 HDD slots)
    $0 boot umbrelos-amd64.img --memory 4096       # Boot specific image
    $0 boot --arch arm64                           # Boot arm64 image
    $0 nvme add 1 --size 128G
    $0 sata add 1 --size 4T --type hdd
    $0 nvme list
    $0 sata list

EOF
}

# Initialize state directory and state files
init_state() {
  mkdir -p "$STATE_DIR"
  if [[ ! -f "$NVME_STATE_FILE" ]]; then
    echo '{}' > "$NVME_STATE_FILE"
  fi
  if [[ ! -f "$HDD_STATE_FILE" ]]; then
    echo '{}' > "$HDD_STATE_FILE"
  fi
}

# Get NVMe state for a slot
get_nvme_state() {
  local slot="$1"
  local key="${2:-}"
  if [[ -n "$key" ]]; then
    jq -r ".\"$slot\".$key // empty" "$NVME_STATE_FILE"
  else
    jq -r ".\"$slot\" // empty" "$NVME_STATE_FILE"
  fi
}

# Set NVMe state for a slot
set_nvme_state() {
  local slot="$1"
  local key="$2"
  local value="$3"
  local tmp
  tmp=$(mktemp)
  jq ".\"$slot\".$key = $value" "$NVME_STATE_FILE" > "$tmp" && mv "$tmp" "$NVME_STATE_FILE"
}

# Initialize NVMe entry
init_nvme_entry() {
  local slot="$1"
  local size="$2"
  local serial="$3"
  local tmp
  tmp=$(mktemp)
  jq ".\"$slot\" = {\"size\": \"$size\", \"serial\": \"$serial\", \"connected\": true, \"exists\": true}" "$NVME_STATE_FILE" > "$tmp" && mv "$tmp" "$NVME_STATE_FILE"
}

# Remove NVMe entry
remove_nvme_entry() {
  local slot="$1"
  local tmp
  tmp=$(mktemp)
  jq "del(.\"$slot\")" "$NVME_STATE_FILE" > "$tmp" && mv "$tmp" "$NVME_STATE_FILE"
}

# Validate slot number
validate_slot() {
  local slot="$1"
  local max="${2:-$MAX_NVME_SLOTS}"
  if [[ ! "$slot" =~ ^[0-9]+$ ]] || (( slot < 1 || slot > max )); then
    echo "Error: Slot must be 1-${max}" >&2
    exit 1
  fi
}

# Get disk path for a slot
get_nvme_disk_path() {
  local slot="$1"
  echo "$STATE_DIR/nvme-slot${slot}.qcow2"
}

get_hdd_disk_path() {
  local slot="$1"
  echo "$STATE_DIR/hdd-slot${slot}.qcow2"
}

# Generic disk list function
# Arguments: <type> <state_file> <max_slots>
disk_list() {
  local type="$1"
  local state_file="$2"
  local max_slots="$3"

  init_state
  echo "${type} Devices:"
  echo "============="
  echo
  printf "%-6s %-12s %-10s %-10s\n" "Slot" "Status" "Connected" "Size"
  printf "%-6s %-12s %-10s %-10s\n" "----" "------" "---------" "----"

  for (( slot=1; slot<=max_slots; slot++ )); do
    local exists connected size status
    exists=$(jq -r ".\"$slot\".exists // empty" "$state_file")
    connected=$(jq -r ".\"$slot\".connected // empty" "$state_file")
    size=$(jq -r ".\"$slot\".size // empty" "$state_file")

    if [[ "$exists" == "true" ]]; then
      if [[ "$connected" == "true" ]]; then
        status="present"
        connected="yes"
      else
        status="disconnected"
        connected="no"
      fi
    else
      status="empty"
      connected="-"
      size="-"
    fi

    printf "%-6s %-12s %-10s %-10s\n" "$slot" "$status" "$connected" "$size"
  done
  echo
}

nvme_list() { disk_list "NVMe" "$NVME_STATE_FILE" "$MAX_NVME_SLOTS"; }
sata_list() { disk_list "SATA" "$HDD_STATE_FILE" "$MAX_HDD_SLOTS"; }

sata_add() {
  local slot="$1"
  local size="$2"
  local sata_type="$3"
  local is_ssd="false"
  if [[ "$sata_type" == "ssd" ]]; then
    is_ssd="true"
  fi
  hdd_add "$slot" "$size" "$is_ssd"
}

sata_destroy() { hdd_destroy "$1"; }
sata_connect() { hdd_connect "$1"; }
sata_disconnect() { hdd_disconnect "$1"; }

# Add NVMe device
nvme_add() {
  local slot="$1"
  local size="$2"

  validate_slot "$slot"
  init_state

  local disk_path
  disk_path=$(get_nvme_disk_path "$slot")

  if [[ -f "$disk_path" ]]; then
    echo "Error: NVMe device already exists in slot $slot" >&2
    echo "Use 'nvme destroy $slot' to remove it first" >&2
    exit 1
  fi

  # Generate a unique serial number using timestamp and random suffix
  local serial="nvme${slot}-$(date +%s)-${RANDOM}"

  echo "Creating NVMe device in slot $slot (${size})..."
  qemu-img create -f qcow2 "$disk_path" "$size" >/dev/null
  init_nvme_entry "$slot" "$size" "$serial"
  echo "Done. NVMe device created in slot $slot (serial: $serial)"
}

# Destroy NVMe device
nvme_destroy() {
  local slot="$1"

  validate_slot "$slot"
  init_state

  local disk_path
  disk_path=$(get_nvme_disk_path "$slot")

  if [[ ! -f "$disk_path" ]]; then
    echo "Error: No NVMe device in slot $slot" >&2
    exit 1
  fi

  echo "Destroying NVMe device in slot $slot..."
  rm -f "$disk_path"
  remove_nvme_entry "$slot"
  echo "Done. NVMe device in slot $slot destroyed"
}

# Connect NVMe device
nvme_connect() {
  local slot="$1"

  validate_slot "$slot"
  init_state

  local disk_path
  disk_path=$(get_nvme_disk_path "$slot")

  if [[ ! -f "$disk_path" ]]; then
    echo "Error: No NVMe device in slot $slot" >&2
    echo "Use 'nvme add $slot' to create one first" >&2
    exit 1
  fi

  local connected
  connected=$(get_nvme_state "$slot" "connected")
  if [[ "$connected" == "true" ]]; then
    echo "NVMe device in slot $slot is already connected"
    exit 0
  fi

  set_nvme_state "$slot" "connected" "true"
  echo "NVMe device in slot $slot connected (will be available on next boot)"
}

# Disconnect NVMe device
nvme_disconnect() {
  local slot="$1"

  validate_slot "$slot"
  init_state

  local exists
  exists=$(get_nvme_state "$slot" "exists")

  if [[ "$exists" != "true" ]]; then
    echo "Error: No NVMe device in slot $slot" >&2
    exit 1
  fi

  local connected
  connected=$(get_nvme_state "$slot" "connected")
  if [[ "$connected" != "true" ]]; then
    echo "NVMe device in slot $slot is already disconnected"
    exit 0
  fi

  set_nvme_state "$slot" "connected" "false"
  echo "NVMe device in slot $slot disconnected (will be unavailable on next boot)"
}

# Move NVMe device from one slot to another
nvme_move() {
  local from_slot="$1"
  local to_slot="$2"

  validate_slot "$from_slot"
  validate_slot "$to_slot"
  init_state

  if [[ "$from_slot" == "$to_slot" ]]; then
    echo "Error: Source and destination slots are the same" >&2
    exit 1
  fi

  local from_disk_path to_disk_path
  from_disk_path=$(get_nvme_disk_path "$from_slot")
  to_disk_path=$(get_nvme_disk_path "$to_slot")

  if [[ ! -f "$from_disk_path" ]]; then
    echo "Error: No NVMe device in slot $from_slot" >&2
    exit 1
  fi

  if [[ -f "$to_disk_path" ]]; then
    echo "Error: Slot $to_slot already has an NVMe device" >&2
    echo "Use 'nvme destroy $to_slot' to remove it first" >&2
    exit 1
  fi

  # Move the disk file
  mv "$from_disk_path" "$to_disk_path"

  # Move the state entry
  local tmp from_state
  tmp=$(mktemp)
  from_state=$(get_nvme_state "$from_slot")
  jq ".\"$to_slot\" = $from_state | del(.\"$from_slot\")" "$NVME_STATE_FILE" > "$tmp" && mv "$tmp" "$NVME_STATE_FILE"

  echo "NVMe device moved from slot $from_slot to slot $to_slot"
}

# Add HDD device
hdd_add() {
  local slot="$1"
  local size="$2"
  local is_ssd="$3"

  validate_slot "$slot" "$MAX_HDD_SLOTS"
  init_state

  local disk_path
  disk_path=$(get_hdd_disk_path "$slot")

  if [[ -f "$disk_path" ]]; then
    echo "Error: HDD already exists in slot $slot" >&2
    echo "Use 'sata destroy $slot' to remove it first" >&2
    exit 1
  fi

  local label="HDD"
  local serial_prefix="hdd"
  if [[ "$is_ssd" == "true" ]]; then
    label="SATA SSD"
    serial_prefix="satassd"
  fi
  local serial="${serial_prefix}${slot}-$(date +%s)-${RANDOM}"

  echo "Creating ${label} in slot $slot (${size})..."
  qemu-img create -f qcow2 "$disk_path" "$size" >/dev/null
  local tmp
  tmp=$(mktemp)
  jq --arg size "$size" --arg serial "$serial" --argjson is_ssd "$is_ssd" \
    ".\"$slot\" = {\"size\": \$size, \"serial\": \$serial, \"connected\": true, \"exists\": true, \"ssd\": \$is_ssd}" \
    "$HDD_STATE_FILE" > "$tmp" && mv "$tmp" "$HDD_STATE_FILE"
  echo "Done. ${label} created in slot $slot (serial: $serial)"
}

# Destroy HDD device
hdd_destroy() {
  local slot="$1"

  validate_slot "$slot" "$MAX_HDD_SLOTS"
  init_state

  local disk_path
  disk_path=$(get_hdd_disk_path "$slot")

  if [[ ! -f "$disk_path" ]]; then
    echo "Error: No HDD in slot $slot" >&2
    exit 1
  fi

  echo "Destroying HDD in slot $slot..."
  rm -f "$disk_path"
  local tmp
  tmp=$(mktemp)
  jq "del(.\"$slot\")" "$HDD_STATE_FILE" > "$tmp" && mv "$tmp" "$HDD_STATE_FILE"
  echo "Done. HDD in slot $slot destroyed"
}

# Connect HDD device
hdd_connect() {
  local slot="$1"

  validate_slot "$slot" "$MAX_HDD_SLOTS"
  init_state

  local disk_path
  disk_path=$(get_hdd_disk_path "$slot")

  if [[ ! -f "$disk_path" ]]; then
    echo "Error: No HDD in slot $slot" >&2
    echo "Use 'sata add $slot --type hdd' to create one first" >&2
    exit 1
  fi

  local connected
  connected=$(jq -r ".\"$slot\".connected // empty" "$HDD_STATE_FILE")
  if [[ "$connected" == "true" ]]; then
    echo "HDD in slot $slot is already connected"
    exit 0
  fi

  local tmp
  tmp=$(mktemp)
  jq ".\"$slot\".connected = true" "$HDD_STATE_FILE" > "$tmp" && mv "$tmp" "$HDD_STATE_FILE"
  echo "HDD in slot $slot connected (will be available on next boot)"
}

# Disconnect HDD device
hdd_disconnect() {
  local slot="$1"

  validate_slot "$slot" "$MAX_HDD_SLOTS"
  init_state

  local exists
  exists=$(jq -r ".\"$slot\".exists // empty" "$HDD_STATE_FILE")

  if [[ "$exists" != "true" ]]; then
    echo "Error: No HDD in slot $slot" >&2
    exit 1
  fi

  local connected
  connected=$(jq -r ".\"$slot\".connected // empty" "$HDD_STATE_FILE")
  if [[ "$connected" != "true" ]]; then
    echo "HDD in slot $slot is already disconnected"
    exit 0
  fi

  local tmp
  tmp=$(mktemp)
  jq ".\"$slot\".connected = false" "$HDD_STATE_FILE" > "$tmp" && mv "$tmp" "$HDD_STATE_FILE"
  echo "HDD in slot $slot disconnected (will be unavailable on next boot)"
}

# Build QEMU HDD arguments for connected devices (SATA via AHCI)
build_hdd_args() {
  local hdd_args=""
  local has_hdd=false

  for (( slot=1; slot<=MAX_HDD_SLOTS; slot++ )); do
    local exists connected
    exists=$(jq -r ".\"$slot\".exists // empty" "$HDD_STATE_FILE")
    connected=$(jq -r ".\"$slot\".connected // empty" "$HDD_STATE_FILE")

    if [[ "$exists" == "true" && "$connected" == "true" ]]; then
      local disk_path serial ssd rotation_rate
      disk_path=$(get_hdd_disk_path "$slot")
      serial=$(jq -r ".\"$slot\".serial // empty" "$HDD_STATE_FILE")
      ssd=$(jq -r ".\"$slot\".ssd // false" "$HDD_STATE_FILE")
      if [[ -z "$serial" ]]; then
        serial="hdd${slot}"
      fi
      rotation_rate=7200
      if [[ "$ssd" == "true" ]]; then
        # ATA nominal media rotation rate of 1 indicates non-rotational media (SSD).
        rotation_rate=1
      fi

      # Add AHCI controller on first HDD
      if [[ "$has_hdd" == "false" ]]; then
        hdd_args="$hdd_args -device ahci,id=ahci"
        has_hdd=true
      fi

      hdd_args="$hdd_args -drive file=${disk_path},format=qcow2,if=none,id=hdd${slot},cache=none,discard=unmap,aio=threads"
      hdd_args="$hdd_args -device ide-hd,drive=hdd${slot},bus=ahci.$(( slot - 1 )),serial=${serial},rotation_rate=${rotation_rate}"
    fi
  done

  echo "$hdd_args"
}

# Build QEMU NVMe arguments for connected devices
# Arguments: <device>
build_nvme_args() {
  local device="$1"
  local nvme_args=""

  for (( slot=1; slot<=MAX_NVME_SLOTS; slot++ )); do
    local exists connected disk_path serial
    exists=$(get_nvme_state "$slot" "exists")
    connected=$(get_nvme_state "$slot" "connected")

    if [[ "$exists" == "true" && "$connected" == "true" ]]; then
      disk_path=$(get_nvme_disk_path "$slot")
      serial=$(get_nvme_state "$slot" "serial")
      if [[ -z "$serial" ]]; then
        serial="nvme${slot}"
      fi

      # Umbrel Pro uses specific PCIe slot numbers to match real hardware
      local pci_slot
      if [[ "$device" == "umbrel-pro" ]]; then
        pci_slot=$(get_umbrel_pro_pci_slot "$slot")
      fi
      if [[ -z "${pci_slot:-}" ]]; then
        pci_slot=$(( 20 + slot ))
      fi

      nvme_args="$nvme_args -device pcie-root-port,id=rp${slot},slot=${pci_slot},chassis=${slot}"
      nvme_args="$nvme_args -drive file=${disk_path},format=qcow2,if=none,id=nvme${slot},cache=none,discard=unmap,aio=threads"
      nvme_args="$nvme_args -device nvme,drive=nvme${slot},serial=${serial},bus=rp${slot}"
    fi
  done

  echo "$nvme_args"
}

# Detect architecture from image filename
detect_arch() {
  local image="$1"
  local basename
  basename=$(basename "$image")

  if [[ "$basename" == *"arm64"* || "$basename" == *"aarch64"* ]]; then
    echo "arm64"
  elif [[ "$basename" == *"amd64"* || "$basename" == *"x86_64"* || "$basename" == *"x86-64"* ]]; then
    echo "amd64"
  else
    # Default to amd64 for backwards compatibility
    echo "amd64"
  fi
}

# Detect UEFI firmware paths for the given architecture
detect_uefi_firmware() {
  local arch="$1"

  if [[ "$arch" == "arm64" ]]; then
    # ARM64 UEFI firmware (AAVMF)
    if [[ -f "/opt/homebrew/share/qemu/edk2-aarch64-code.fd" ]]; then
      UEFI_CODE="/opt/homebrew/share/qemu/edk2-aarch64-code.fd"
      UEFI_VARS_TEMPLATE="/opt/homebrew/share/qemu/edk2-arm-vars.fd"
    elif [[ -f "/usr/local/share/qemu/edk2-aarch64-code.fd" ]]; then
      UEFI_CODE="/usr/local/share/qemu/edk2-aarch64-code.fd"
      UEFI_VARS_TEMPLATE="/usr/local/share/qemu/edk2-arm-vars.fd"
    elif [[ -f "/usr/share/AAVMF/AAVMF_CODE.fd" ]]; then
      UEFI_CODE="/usr/share/AAVMF/AAVMF_CODE.fd"
      UEFI_VARS_TEMPLATE="/usr/share/AAVMF/AAVMF_VARS.fd"
    elif [[ -f "/usr/share/qemu-efi-aarch64/QEMU_EFI.fd" ]]; then
      UEFI_CODE="/usr/share/qemu-efi-aarch64/QEMU_EFI.fd"
      UEFI_VARS_TEMPLATE="/usr/share/qemu-efi-aarch64/vars-template-pflash.raw"
    else
      echo "Error: ARM64 UEFI firmware not found. On macOS: brew install qemu" >&2
      exit 1
    fi
  else
    # AMD64 UEFI firmware (OVMF)
    if [[ -f "/opt/homebrew/share/qemu/edk2-x86_64-code.fd" ]]; then
      UEFI_CODE="/opt/homebrew/share/qemu/edk2-x86_64-code.fd"
      UEFI_VARS_TEMPLATE="/opt/homebrew/share/qemu/edk2-i386-vars.fd"
    elif [[ -f "/usr/local/share/qemu/edk2-x86_64-code.fd" ]]; then
      UEFI_CODE="/usr/local/share/qemu/edk2-x86_64-code.fd"
      UEFI_VARS_TEMPLATE="/usr/local/share/qemu/edk2-i386-vars.fd"
    elif [[ -f "/usr/share/OVMF/OVMF_CODE_4M.fd" ]]; then
      UEFI_CODE="/usr/share/OVMF/OVMF_CODE_4M.fd"
      UEFI_VARS_TEMPLATE="/usr/share/OVMF/OVMF_VARS_4M.fd"
    else
      echo "Error: AMD64 UEFI firmware not found. On macOS: brew install qemu" >&2
      exit 1
    fi
  fi
}

# Boot the VM
boot_vm() {
  local image="$1"
  local arch="$2"
  local device="$3"
  local memory="$4"
  local cores="$5"
  local disk_size="$6"
  local ssh_port="$7"
  local http_port="$8"

  init_state
  detect_uefi_firmware "$arch"

  if [[ ! -f "$image" ]]; then
    echo "Error: Image not found: $image" >&2
    exit 1
  fi

  command -v qemu-img >/dev/null 2>&1 || { echo "Error: 'qemu-img' not found in PATH" >&2; exit 1; }

  local qemu_binary
  if [[ "$arch" == "arm64" ]]; then
    qemu_binary="qemu-system-aarch64"
  else
    qemu_binary="qemu-system-x86_64"
  fi
  command -v "$qemu_binary" >/dev/null 2>&1 || { echo "Error: '$qemu_binary' not found in PATH" >&2; exit 1; }

  # Setup UEFI VARS
  local uefi_vars="$STATE_DIR/uefi-vars-${arch}.fd"
  if [[ ! -f "$uefi_vars" ]]; then
    cp "$UEFI_VARS_TEMPLATE" "$uefi_vars"
  fi

  # Setup overlay disk
  local overlay="$STATE_DIR/overlay-${arch}.qcow2"
  if [[ ! -f "$overlay" ]]; then
    echo "Creating overlay image..."
    local image_abs
    image_abs="$(cd "$(dirname "$image")" && pwd)/$(basename "$image")"
    qemu-img create -f qcow2 -F raw -b "$image_abs" "$overlay" "$disk_size" >/dev/null
  else
    echo "Using existing overlay image"
  fi

  # Device-specific SMBIOS and boot disk settings
  local smbios_args boot_disk_args
  case "$device" in
    umbrel-home)
      smbios_args=(-smbios "type=1,manufacturer=Umbrel,, Inc.,product=Umbrel Home,sku=U130122,family=NAS")
      # Umbrel Home has no eMMC — the OS lives on the NVMe SSD
      boot_disk_args="-drive file=$overlay,if=none,id=boot,format=qcow2,cache=none,discard=unmap,aio=threads -device nvme,drive=boot,serial=umbrel-home-ssd,bootindex=0"
      ;;
    umbrel-pro)
      smbios_args=(-smbios "type=1,manufacturer=Umbrel,, Inc.,product=Umbrel Pro,sku=U4XN1,family=NAS")
      # Umbrel Pro boots from eMMC (virtio-blk), NVMe slots are for data SSDs
      boot_disk_args="-drive file=$overlay,if=none,id=boot,format=qcow2,cache=none,discard=unmap,aio=threads -device virtio-blk-pci,drive=boot,bootindex=0"
      ;;
    nas)
      smbios_args=(-smbios "type=1,manufacturer=Generic,product=NAS,family=NAS")
      # Generic NAS boots from eMMC (virtio-blk), has NVMe and SATA slots for storage
      boot_disk_args="-drive file=$overlay,if=none,id=boot,format=qcow2,cache=none,discard=unmap,aio=threads -device virtio-blk-pci,drive=boot,bootindex=0"
      ;;
  esac

  # Build disk arguments for data drives
  local nvme_args hdd_args
  nvme_args=$(build_nvme_args "$device")
  hdd_args=$(build_hdd_args)

  # Platform and architecture-specific settings
  local accel_args machine_args cpu_args
  local qemu_sudo=""

  if [[ "$arch" == "arm64" ]]; then
    # ARM64 settings
    case "$(uname -s)" in
      Linux)
        accel_args="-enable-kvm"
        cpu_args="-cpu host"
        qemu_sudo="sudo"
        ;;
      Darwin)
        if "$qemu_binary" -accel help 2>&1 | grep -q hvf; then
          accel_args="-accel hvf"
          cpu_args="-cpu host"
        else
          echo "WARNING: HVF not available, using TCG (slow)" >&2
          accel_args="-accel tcg"
          cpu_args="-cpu max"
        fi
        ;;
      *)
        echo "Error: Unsupported platform: $(uname -s)" >&2
        exit 1
        ;;
    esac
    machine_args="-machine virt,gic-version=3"
  else
    # AMD64 settings
    case "$(uname -s)" in
      Linux)
        accel_args="-enable-kvm"
        machine_args="-machine accel=kvm,type=q35"
        cpu_args="-cpu host"
        qemu_sudo="sudo"
        ;;
      Darwin)
        if "$qemu_binary" -accel help 2>&1 | grep -q hvf; then
          accel_args=""
          machine_args="-machine accel=hvf,type=q35"
          cpu_args="-cpu max"
        else
          echo "WARNING: HVF not available, using TCG (slow)" >&2
          accel_args=""
          machine_args="-machine accel=tcg,type=q35"
          cpu_args="-cpu max"
        fi
        ;;
      *)
        echo "Error: Unsupported platform: $(uname -s)" >&2
        exit 1
        ;;
    esac
  fi

  echo "Booting VM (${arch}, ${device})..."
  echo "  SSH: ssh -p ${ssh_port} umbrel@localhost"
  echo "  HTTP: http://localhost:${http_port}"
  echo

  # shellcheck disable=SC2086
  exec $qemu_sudo "$qemu_binary" \
    $accel_args \
    $machine_args \
    $cpu_args \
    -smp "$cores" \
    -m "$memory" \
    -rtc base=utc \
    -nographic -monitor none -chardev stdio,id=char0,signal=off -serial chardev:char0 \
    "${smbios_args[@]}" \
    -drive if=pflash,format=raw,readonly=on,file="$UEFI_CODE" \
    -drive if=pflash,format=raw,file="$uefi_vars" \
    $boot_disk_args \
    -netdev user,id=net0,hostfwd=tcp:127.0.0.1:${ssh_port}-:22,hostfwd=tcp:127.0.0.1:${http_port}-:80 \
    -device virtio-net-pci,netdev=net0 \
    $nvme_args \
    $hdd_args
}

# Reflash (delete overlay to simulate fresh OS install)
reflash() {
  local found=false
  for arch in amd64 arm64; do
    local overlay="$STATE_DIR/overlay-${arch}.qcow2"
    if [[ -f "$overlay" ]]; then
      echo "Removing ${arch} boot disk overlay..."
      rm -f "$overlay"
      found=true
    fi
  done
  # Also check for legacy overlay without arch suffix
  local legacy_overlay="$STATE_DIR/overlay.qcow2"
  if [[ -f "$legacy_overlay" ]]; then
    echo "Removing legacy boot disk overlay..."
    rm -f "$legacy_overlay"
    found=true
  fi
  if [[ "$found" == "true" ]]; then
    echo "Done. Next boot will start fresh."
  else
    echo "No overlay to remove."
  fi
}

# Reset all state
reset_state() {
  if [[ -d "$STATE_DIR" ]]; then
    echo "Removing VM state directory: $STATE_DIR"
    rm -rf "$STATE_DIR"
    echo "Done."
  else
    echo "No state to reset."
  fi
}

# Main
if [[ $# -lt 1 ]]; then
  show_help
  exit 1
fi

command="$1"
shift

case "$command" in
  help|--help|-h)
    show_help
    exit 0
    ;;

  reflash)
    reflash
    exit 0
    ;;

  reset)
    reset_state
    exit 0
    ;;

  nvme)
    if [[ $# -lt 1 ]]; then
      echo "Error: nvme requires a subcommand" >&2
      echo "Usage: $0 nvme <list|add|destroy|connect|disconnect> [args]" >&2
      exit 1
    fi

    subcommand="$1"
    shift

    case "$subcommand" in
      list)
        nvme_list
        ;;
      add)
        if [[ $# -lt 1 ]]; then
          echo "Error: nvme add requires a slot number" >&2
          exit 1
        fi
        slot="$1"
        shift
        size="$DEFAULT_NVME_SIZE"
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --size)
              size="$2"
              shift 2
              ;;
            *)
              echo "Error: Unknown option: $1" >&2
              exit 1
              ;;
          esac
        done
        nvme_add "$slot" "$size"
        ;;
      destroy)
        if [[ $# -lt 1 ]]; then
          echo "Error: nvme destroy requires a slot number" >&2
          exit 1
        fi
        nvme_destroy "$1"
        ;;
      connect)
        if [[ $# -lt 1 ]]; then
          echo "Error: nvme connect requires a slot number" >&2
          exit 1
        fi
        nvme_connect "$1"
        ;;
      disconnect)
        if [[ $# -lt 1 ]]; then
          echo "Error: nvme disconnect requires a slot number" >&2
          exit 1
        fi
        nvme_disconnect "$1"
        ;;
      move)
        if [[ $# -lt 2 ]]; then
          echo "Error: nvme move requires source and destination slot numbers" >&2
          echo "Usage: $0 nvme move <from-slot> <to-slot>" >&2
          exit 1
        fi
        nvme_move "$1" "$2"
        ;;
      *)
        echo "Error: Unknown nvme subcommand: $subcommand" >&2
        echo "Usage: $0 nvme <list|add|destroy|connect|disconnect|move> [args]" >&2
        exit 1
        ;;
    esac
    exit 0
    ;;

  sata)
    if [[ $# -lt 1 ]]; then
      echo "Error: sata requires a subcommand" >&2
      echo "Usage: $0 sata <list|add|destroy|connect|disconnect> [args]" >&2
      exit 1
    fi

    subcommand="$1"
    shift

    case "$subcommand" in
      list)
        sata_list
        ;;
      add)
        if [[ $# -lt 1 ]]; then
          echo "Error: sata add requires a slot number" >&2
          exit 1
        fi
        slot="$1"
        shift
        size="$DEFAULT_HDD_SIZE"
        sata_type="hdd"
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --size)
              size="$2"
              shift 2
              ;;
            --type)
              sata_type="$2"
              shift 2
              ;;
            *)
              echo "Error: Unknown option: $1" >&2
              exit 1
              ;;
          esac
        done
        if [[ "$sata_type" != "hdd" && "$sata_type" != "ssd" ]]; then
          echo "Error: --type must be one of: hdd, ssd" >&2
          exit 1
        fi
        sata_add "$slot" "$size" "$sata_type"
        ;;
      destroy)
        if [[ $# -lt 1 ]]; then
          echo "Error: sata destroy requires a slot number" >&2
          exit 1
        fi
        sata_destroy "$1"
        ;;
      connect)
        if [[ $# -lt 1 ]]; then
          echo "Error: sata connect requires a slot number" >&2
          exit 1
        fi
        sata_connect "$1"
        ;;
      disconnect)
        if [[ $# -lt 1 ]]; then
          echo "Error: sata disconnect requires a slot number" >&2
          exit 1
        fi
        sata_disconnect "$1"
        ;;
      *)
        echo "Error: Unknown sata subcommand: $subcommand" >&2
        echo "Usage: $0 sata <list|add|destroy|connect|disconnect> [args]" >&2
        exit 1
        ;;
    esac
    exit 0
    ;;

  boot)
    image=""
    arch=""
    device="$DEFAULT_DEVICE"
    memory="$DEFAULT_MEMORY"
    cores="$DEFAULT_CORES"
    disk_size="$DEFAULT_DISK_SIZE"
    ssh_port="$DEFAULT_SSH_PORT"
    http_port="$DEFAULT_HTTP_PORT"

    # Check if first argument is an image path (not an option)
    if [[ $# -gt 0 && ! "$1" =~ ^-- ]]; then
      image="$1"
      shift
    fi

    while [[ $# -gt 0 ]]; do
      case "$1" in
        --device)
          device="$2"
          if [[ "$device" != "umbrel-pro" && "$device" != "umbrel-home" && "$device" != "nas" ]]; then
            echo "Error: --device must be 'umbrel-pro', 'umbrel-home', or 'nas'" >&2
            exit 1
          fi
          shift 2
          ;;
        --arch)
          arch="$2"
          if [[ "$arch" != "amd64" && "$arch" != "arm64" ]]; then
            echo "Error: --arch must be 'amd64' or 'arm64'" >&2
            exit 1
          fi
          shift 2
          ;;
        --memory)
          memory="$2"
          shift 2
          ;;
        --cores)
          cores="$2"
          shift 2
          ;;
        --disk-size)
          disk_size="$2"
          shift 2
          ;;
        --ssh-port)
          ssh_port="$2"
          shift 2
          ;;
        --http-port)
          http_port="$2"
          shift 2
          ;;
        *)
          echo "Error: Unknown option: $1" >&2
          exit 1
          ;;
      esac
    done

    # If no image specified, infer from architecture
    if [[ -z "$image" ]]; then
      # If arch not specified, use native arch
      if [[ -z "$arch" ]]; then
        arch=$(get_native_arch)
        echo "Using native architecture: $arch"
      fi
      image=$(get_default_image "$arch")
      echo "Using default image: $image"
    else
      # Image specified - auto-detect architecture if not specified
      if [[ -z "$arch" ]]; then
        arch=$(detect_arch "$image")
        echo "Auto-detected architecture: $arch"
      fi
    fi

    boot_vm "$image" "$arch" "$device" "$memory" "$cores" "$disk_size" "$ssh_port" "$http_port"
    ;;

  *)
    echo "Error: Unknown command: $command" >&2
    show_help
    exit 1
    ;;
esac
