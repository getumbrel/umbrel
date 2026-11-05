#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${VM_STATE_DIR:-$SCRIPT_DIR/vm-state}"
NVME_STATE_FILE="$STATE_DIR/nvme.json"
HDD_STATE_FILE="$STATE_DIR/hdd.json"
SAS_STATE_FILE="$STATE_DIR/sas.json"
USB_STATE_FILE="$STATE_DIR/usb.json"
USB_SERIAL_STATE_FILE="$STATE_DIR/usb-serial.json"
USB_NET_STATE_FILE="$STATE_DIR/usb-net.json"
QMP_SOCKET=""
RUNNING_DEVICE_FILE="$STATE_DIR/running-device"

# Defaults
DEFAULT_DEVICE="umbrel-pro"
DEFAULT_MEMORY=2048
DEFAULT_CORES=4
DEFAULT_DISK_SIZE="64G"
# QEMU SD cards require a power-of-2 size, and 16G is the smallest that fits
# the Pi image: rugix's first-boot bootstrap clones the ~5GiB system partition
# for the A/B slot, so the card needs ~10.6GiB before the data partition.
# (8G was tried and the bootstrap can't complete — the VM never reaches SSH.)
DEFAULT_PI_DISK_SIZE="16G"
DEFAULT_SSH_PORT=2222
DEFAULT_HTTP_PORT=8080
DEFAULT_NVME_SIZE="64G"
DEFAULT_HDD_SIZE="1T"
DEFAULT_USB_STORAGE_SIZE="64G"
MAX_NVME_SLOTS=8
MAX_HDD_SLOTS=8
MAX_SAS_SLOTS=8
MAX_USB_STORAGE_SLOTS=8
# One per USB 2 port on the serial adapters' own xHCI controller
MAX_USB_SERIAL_SLOTS=4
# Likewise for the network adapters' controller
MAX_USB_NET_SLOTS=4

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

get_default_pi_image() {
  echo "$SCRIPT_DIR/build/umbrelos-pi.img"
}

find_command() {
  local name="$1"
  shift

  if command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
    return
  fi

  local candidate
  for candidate in "$@"; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  done

  echo "Error: '$name' not found in PATH" >&2
  exit 1
}

show_help() {
  cat << EOF
vm.sh - Manage an umbrelOS QEMU virtual machine

Usage: $0 <command> [options]

Commands:
    boot [image]                   Boot VM from the given image (defaults to native arch image)
    reflash                        Delete boot disk overlay (simulates reflashing the OS)
    reset                          Delete all VM state (overlay, NVMe disks, SATA/SAS drives, UEFI vars)
    power-button                   Press the power button of the running VM (ACPI power button event)

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
    sata move <from> <to>          Move a SATA device from one slot to another

    sas list                       List all SAS slot devices and their status
    sas add <slot> [--size SIZE] [--type hdd|ssd]
                                   Add a HDD/SSD behind a SAS HBA to slot (1-${MAX_SAS_SLOTS})
    sas destroy <slot>             Destroy SAS device (deletes data)
    sas connect <slot>             Connect an existing SAS device to the VM
    sas disconnect <slot>          Disconnect a SAS device from the VM
    sas move <from> <to>           Move a SAS device from one slot to another

    usb list                       List all USB storage devices and their status
    usb add <slot> [--size SIZE]   Add a USB storage device to slot (1-${MAX_USB_STORAGE_SLOTS})
    usb destroy <slot>             Destroy USB storage device (deletes data)
    usb connect <slot>             Connect an existing USB storage device to the running VM
    usb disconnect <slot>          Disconnect USB storage from the running VM without deleting data

    usb-serial list                Live USB serial adapters (FTDI, 0403:6001) and their status
    usb-serial add <slot> [--serial SERIAL]
                                   Add a USB serial adapter to slot (1-${MAX_USB_SERIAL_SLOTS}), plugged into port <slot>
                                   of its own xHCI controller. Adapters get distinct serial numbers
                                   unless one is given, so identical ones can share a serial number.
    usb-serial remove <slot>       Remove the USB serial adapter from slot
    usb-serial connect <slot>      Plug the USB serial adapter back into the running VM
    usb-serial disconnect <slot>   Unplug the USB serial adapter from the running VM
    usb-serial swap <slot>         Replace the adapter with a QEMU USB keyboard (0627:0001) in the same
                                   port, or swap the keyboard back, as a device reconnecting as a
                                   different model does once its firmware loads

    usb-net list                   List USB network adapters (QEMU usb-net, 0525:a4a2) and their status
    usb-net add <slot>             Add a USB network adapter to slot (1-${MAX_USB_NET_SLOTS}), plugged into port <slot>
                                   of its own xHCI controller. Each one is on a network of its own,
                                   10.0.<10 + slot>.0/24, which hands out addresses over DHCP.
    usb-net remove <slot>          Remove the USB network adapter from slot
    usb-net connect <slot>         Plug the USB network adapter back into the running VM
    usb-net disconnect <slot>      Unplug the USB network adapter from the running VM

Boot Options:
    --device <type>                Device to emulate: umbrel-pro, umbrel-home, nas, pi (default: ${DEFAULT_DEVICE})
    --boot-disk <type>             Boot disk transport: default, emmc, nvme, usb, sdcard, none (default: default for device)
    --cdrom <path>                 Attach an ISO as a bootable CD-ROM (amd64 only), e.g. the USB installer
    --boot-nvme-slot <slot>        Boot from the NVMe device in this slot, e.g. after the USB installer flashed it
    --arch <amd64|arm64>           CPU architecture (default: auto-detect from image name)
    --memory <MiB>                 RAM in MiB (default: ${DEFAULT_MEMORY})
    --cores <count>                CPU cores (default: ${DEFAULT_CORES})
    --disk-size <size>             Boot disk size (default: ${DEFAULT_DISK_SIZE}, ${DEFAULT_PI_DISK_SIZE} for pi;
                                   sdcard boot disks require a power-of-2 size)
    --ssh-port <port>              Local SSH port forward (default: ${DEFAULT_SSH_PORT})
    --http-port <port>             Local HTTP port forward (default: ${DEFAULT_HTTP_PORT})
    --forward-port <host:guest>    Extra local TCP port forward to the VM, repeatable

Disk Options:
    --size <size>                  Disk size for nvme/sata/sas/usb add (default: ${DEFAULT_NVME_SIZE} nvme, ${DEFAULT_HDD_SIZE} sata/sas, ${DEFAULT_USB_STORAGE_SIZE} usb)
    --type <hdd|ssd>               For sata/sas add only: set device type (default: hdd)

Environment Variables:
    VM_STATE_DIR                   Override state directory (default: ./vm-state)

Examples:
    $0 boot                                        # Boot native arch image as Umbrel Pro
    $0 boot --device umbrel-home                   # Boot as Umbrel Home (NVMe boot, no eMMC)
    $0 boot --device nas                           # Boot as generic NAS (8 SSD + 8 HDD slots)
    $0 boot --device nas --boot-disk usb           # Boot generic NAS from USB storage
    $0 boot --device pi                            # Boot Pi image in an emulated Raspberry Pi 4
    $0 boot umbrelos-amd64.img --memory 4096       # Boot specific image
    $0 boot --arch arm64                           # Boot arm64 image
    $0 nvme add 1 --size 128G
    $0 sata add 1 --size 4T --type hdd
    $0 sas add 1 --size 4T --type ssd
    $0 usb add 1 --size 128G
    $0 nvme list
    $0 sata list
    $0 usb list

EOF
}

initialize_qmp_socket() {
  [[ -n "$QMP_SOCKET" ]] && return

  local canonical_state_dir digest
  if [[ -d "$STATE_DIR" ]]; then
    canonical_state_dir="$(cd "$STATE_DIR" && pwd -P)"
  else
    local state_parent state_name
    state_parent="$(dirname "$STATE_DIR")"
    state_name="$(basename "$STATE_DIR")"
    if [[ -d "$state_parent" ]]; then
      canonical_state_dir="$(cd "$state_parent" && pwd -P)/$state_name"
    elif [[ "$STATE_DIR" == /* ]]; then
      canonical_state_dir="$STATE_DIR"
    else
      canonical_state_dir="$(pwd -P)/$STATE_DIR"
    fi
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    digest=$(printf '%s' "$canonical_state_dir" | sha256sum)
  elif command -v shasum >/dev/null 2>&1; then
    digest=$(printf '%s' "$canonical_state_dir" | shasum -a 256)
  else
    echo "Error: sha256sum or shasum is required to identify the VM QMP socket" >&2
    exit 1
  fi
  digest="${digest%% *}"
  QMP_SOCKET="/tmp/umbrel-vm-${digest:0:16}.qmp"
}

remove_qmp_socket() {
  initialize_qmp_socket
  if [[ "$(uname -s)" == "Linux" ]]; then
    # QEMU runs through sudo for KVM and therefore owns its QMP socket as root.
    # A force-killed VM cannot remove the socket itself, so the next boot must
    # clean it up with the same privilege before QEMU can bind the path again.
    sudo rm -f -- "$QMP_SOCKET"
  else
    rm -f -- "$QMP_SOCKET"
  fi
}

# Initialize state directory and state files
init_state() {
  mkdir -p "$STATE_DIR"
  initialize_qmp_socket
  if [[ ! -f "$NVME_STATE_FILE" ]]; then
    echo '{}' > "$NVME_STATE_FILE"
  fi
  if [[ ! -f "$HDD_STATE_FILE" ]]; then
    echo '{}' > "$HDD_STATE_FILE"
  fi
  if [[ ! -f "$SAS_STATE_FILE" ]]; then
    echo '{}' > "$SAS_STATE_FILE"
  fi
  if [[ ! -f "$USB_STATE_FILE" ]]; then
    echo '{}' > "$USB_STATE_FILE"
  fi
  if [[ ! -f "$USB_SERIAL_STATE_FILE" ]]; then
    echo '{}' > "$USB_SERIAL_STATE_FILE"
  fi
  if [[ ! -f "$USB_NET_STATE_FILE" ]]; then
    echo '{}' > "$USB_NET_STATE_FILE"
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

get_sas_disk_path() {
  local slot="$1"
  echo "$STATE_DIR/sas-slot${slot}.qcow2"
}

# SATA and SAS drive bays share one implementation, keyed by bus
get_bay_state_file() {
  local bus="$1"
  if [[ "$bus" == "sas" ]]; then echo "$SAS_STATE_FILE"; else echo "$HDD_STATE_FILE"; fi
}

get_bay_max_slots() {
  local bus="$1"
  if [[ "$bus" == "sas" ]]; then echo "$MAX_SAS_SLOTS"; else echo "$MAX_HDD_SLOTS"; fi
}

get_bay_disk_path() {
  local bus="$1"
  local slot="$2"
  if [[ "$bus" == "sas" ]]; then get_sas_disk_path "$slot"; else get_hdd_disk_path "$slot"; fi
}

get_bay_label() {
  local bus="$1"
  if [[ "$bus" == "sas" ]]; then echo "SAS drive"; else echo "HDD"; fi
}

get_usb_disk_path() {
  local slot="$1"
  echo "$STATE_DIR/usb-slot${slot}.qcow2"
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
sas_list() { disk_list "SAS" "$SAS_STATE_FILE" "$MAX_SAS_SLOTS"; }
usb_list() { disk_list "USB Storage" "$USB_STATE_FILE" "$MAX_USB_STORAGE_SLOTS"; }

# Arguments: <bus> <slot> <size> <hdd|ssd>
bay_add() {
  local bus="$1"
  local slot="$2"
  local size="$3"
  local drive_type="$4"
  local is_ssd="false"
  if [[ "$drive_type" == "ssd" ]]; then
    is_ssd="true"
  fi
  hdd_add "$bus" "$slot" "$size" "$is_ssd"
}

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

# Add a drive to a SATA or SAS bay
# Arguments: <bus> <slot> <size> <is_ssd>
hdd_add() {
  local bus="$1"
  local slot="$2"
  local size="$3"
  local is_ssd="$4"
  local state_file
  state_file=$(get_bay_state_file "$bus")

  validate_slot "$slot" "$(get_bay_max_slots "$bus")"
  init_state

  local disk_path
  disk_path=$(get_bay_disk_path "$bus" "$slot")

  if [[ -f "$disk_path" ]]; then
    echo "Error: $(get_bay_label "$bus") already exists in slot $slot" >&2
    echo "Use '$bus destroy $slot' to remove it first" >&2
    exit 1
  fi

  local label="HDD"
  local serial_prefix="hdd"
  if [[ "$is_ssd" == "true" ]]; then
    label="SATA SSD"
    serial_prefix="satassd"
  fi
  # Every SAS device carries a unique NAA world wide name, which udev prefers over the
  # serial for its ID. Persist one per drive so its ID is stable across boots.
  local wwn=""
  if [[ "$bus" == "sas" ]]; then
    label="SAS ${label#SATA }"
    serial_prefix="sas${serial_prefix#sata}"
    wwn=$(printf '0x5000c500%02x%06x' "$slot" "$(( (RANDOM << 9 ^ RANDOM) & 0xffffff ))")
  fi
  local serial="${serial_prefix}${slot}-$(date +%s)-${RANDOM}"
  # QEMU rejects scsi-hd serials longer than 20 characters (the serial doubles as
  # the device id), so keep SAS ones short: sas{hdd,ssd}N-<epoch><2 digits>.
  if [[ "$bus" == "sas" ]]; then
    serial="${serial_prefix}${slot}-$(date +%s)$((RANDOM % 100))"
  fi

  echo "Creating ${label} in slot $slot (${size})..."
  qemu-img create -f qcow2 "$disk_path" "$size" >/dev/null
  local tmp
  tmp=$(mktemp)
  jq --arg size "$size" --arg serial "$serial" --argjson is_ssd "$is_ssd" --arg wwn "$wwn" \
    ".\"$slot\" = {\"size\": \$size, \"serial\": \$serial, \"connected\": true, \"exists\": true, \"ssd\": \$is_ssd} + (if \$wwn == \"\" then {} else {\"wwn\": \$wwn} end)" \
    "$state_file" > "$tmp" && mv "$tmp" "$state_file"
  echo "Done. ${label} created in slot $slot (serial: $serial)"
}

# Destroy the drive in a SATA or SAS bay
# Arguments: <bus> <slot>
hdd_destroy() {
  local bus="$1"
  local slot="$2"
  local state_file label
  state_file=$(get_bay_state_file "$bus")
  label=$(get_bay_label "$bus")

  validate_slot "$slot" "$(get_bay_max_slots "$bus")"
  init_state

  local disk_path
  disk_path=$(get_bay_disk_path "$bus" "$slot")

  if [[ ! -f "$disk_path" ]]; then
    echo "Error: No $label in slot $slot" >&2
    exit 1
  fi

  echo "Destroying $label in slot $slot..."
  rm -f "$disk_path"
  local tmp
  tmp=$(mktemp)
  jq "del(.\"$slot\")" "$state_file" > "$tmp" && mv "$tmp" "$state_file"
  echo "Done. $label in slot $slot destroyed"
}

# Connect the drive in a SATA or SAS bay
# Arguments: <bus> <slot>
hdd_connect() {
  local bus="$1"
  local slot="$2"
  local state_file label
  state_file=$(get_bay_state_file "$bus")
  label=$(get_bay_label "$bus")

  validate_slot "$slot" "$(get_bay_max_slots "$bus")"
  init_state

  local disk_path
  disk_path=$(get_bay_disk_path "$bus" "$slot")

  if [[ ! -f "$disk_path" ]]; then
    echo "Error: No $label in slot $slot" >&2
    echo "Use '$bus add $slot --type hdd' to create one first" >&2
    exit 1
  fi

  local connected
  connected=$(jq -r ".\"$slot\".connected // empty" "$state_file")
  if [[ "$connected" == "true" ]]; then
    echo "$label in slot $slot is already connected"
    exit 0
  fi

  local tmp
  tmp=$(mktemp)
  jq ".\"$slot\".connected = true" "$state_file" > "$tmp" && mv "$tmp" "$state_file"
  echo "$label in slot $slot connected (will be available on next boot)"
}

# Disconnect the drive in a SATA or SAS bay
# Arguments: <bus> <slot>
hdd_disconnect() {
  local bus="$1"
  local slot="$2"
  local state_file label
  state_file=$(get_bay_state_file "$bus")
  label=$(get_bay_label "$bus")

  validate_slot "$slot" "$(get_bay_max_slots "$bus")"
  init_state

  local exists
  exists=$(jq -r ".\"$slot\".exists // empty" "$state_file")

  if [[ "$exists" != "true" ]]; then
    echo "Error: No $label in slot $slot" >&2
    exit 1
  fi

  local connected
  connected=$(jq -r ".\"$slot\".connected // empty" "$state_file")
  if [[ "$connected" != "true" ]]; then
    echo "$label in slot $slot is already disconnected"
    exit 0
  fi

  local tmp
  tmp=$(mktemp)
  jq ".\"$slot\".connected = false" "$state_file" > "$tmp" && mv "$tmp" "$state_file"
  echo "$label in slot $slot disconnected (will be unavailable on next boot)"
}

# Move the drive in a SATA or SAS bay to another bay on the same controller, keeping
# its serial and WWN like a physically re-seated disk
# Arguments: <bus> <from_slot> <to_slot>
hdd_move() {
  local bus="$1"
  local from_slot="$2"
  local to_slot="$3"
  local state_file label max_slots
  state_file=$(get_bay_state_file "$bus")
  label=$(get_bay_label "$bus")
  max_slots=$(get_bay_max_slots "$bus")

  validate_slot "$from_slot" "$max_slots"
  validate_slot "$to_slot" "$max_slots"
  init_state

  if [[ "$from_slot" == "$to_slot" ]]; then
    echo "Error: Source and destination slots are the same" >&2
    exit 1
  fi

  local from_disk_path to_disk_path
  from_disk_path=$(get_bay_disk_path "$bus" "$from_slot")
  to_disk_path=$(get_bay_disk_path "$bus" "$to_slot")

  if [[ ! -f "$from_disk_path" ]]; then
    echo "Error: No $label in slot $from_slot" >&2
    exit 1
  fi

  if [[ -f "$to_disk_path" ]]; then
    echo "Error: Slot $to_slot already has a $label" >&2
    echo "Use '$bus destroy $to_slot' to remove it first" >&2
    exit 1
  fi

  mv "$from_disk_path" "$to_disk_path"
  local tmp
  tmp=$(mktemp)
  jq ".\"$to_slot\" = .\"$from_slot\" | del(.\"$from_slot\")" "$state_file" > "$tmp" && mv "$tmp" "$state_file"

  echo "$label moved from slot $from_slot to slot $to_slot"
}

# Add USB storage device
usb_add() {
  local slot="$1"
  local size="$2"

  validate_slot "$slot" "$MAX_USB_STORAGE_SLOTS"
  init_state

  if qmp_is_available; then
    echo "Error: Adding new USB storage while the VM is running is not supported. Power off the VM, add the device, then boot it again." >&2
    exit 1
  fi

  local disk_path
  disk_path=$(get_usb_disk_path "$slot")

  if [[ -f "$disk_path" ]]; then
    echo "Error: USB storage already exists in slot $slot" >&2
    echo "Use 'usb destroy $slot' to remove it first" >&2
    exit 1
  fi

  # QEMU rejects usb-storage serials longer than 20 characters (the serial
  # doubles as the device id), so keep this short: usbN-<epoch><4 digits>.
  local serial="usb${slot}-$(date +%s)$((RANDOM % 10000))"

  echo "Creating USB storage in slot $slot (${size})..."
  qemu-img create -f qcow2 "$disk_path" "$size" >/dev/null
  local tmp
  tmp=$(mktemp)
  jq --arg size "$size" --arg serial "$serial" \
    ".\"$slot\" = {\"size\": \$size, \"serial\": \$serial, \"connected\": true, \"exists\": true}" \
    "$USB_STATE_FILE" > "$tmp" && mv "$tmp" "$USB_STATE_FILE"
  echo "Done. USB storage created in slot $slot (serial: $serial)"
}

# Destroy USB storage device
usb_destroy() {
  local slot="$1"

  validate_slot "$slot" "$MAX_USB_STORAGE_SLOTS"
  init_state

  local disk_path
  disk_path=$(get_usb_disk_path "$slot")

  if [[ ! -f "$disk_path" ]]; then
    echo "Error: No USB storage in slot $slot" >&2
    exit 1
  fi

  echo "Destroying USB storage in slot $slot..."
  rm -f "$disk_path"
  local tmp
  tmp=$(mktemp)
  jq "del(.\"$slot\")" "$USB_STATE_FILE" > "$tmp" && mv "$tmp" "$USB_STATE_FILE"
  echo "Done. USB storage in slot $slot destroyed"
}

# Send one QMP command to the running VM. An optional event name and device id
# make destructive hotplug commands wait until QEMU confirms their completion.
qmp_execute() {
  local command="$1"
  local expected_event="${2:-}"
  local expected_device="${3:-}"
  local python
  python=$(find_command python3 /usr/bin/python3 /opt/homebrew/bin/python3)
  local python_code
  python_code=$(cat <<'PY'
import json
import socket
import sys

socket_path, command_json, expected_event, expected_device = sys.argv[1:]
command = json.loads(command_json)

with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
    client.settimeout(15)
    client.connect(socket_path)
    stream = client.makefile("rwb", buffering=0)

    def read_message():
        while True:
            line = stream.readline()
            if not line:
                raise RuntimeError("QMP connection closed")
            message = json.loads(line)
            if message:
                return message

    def send(message):
        stream.write(json.dumps(message, separators=(",", ":")).encode() + b"\n")

    greeting = read_message()
    if "QMP" not in greeting:
        raise RuntimeError("Invalid QMP greeting")
    send({"execute": "qmp_capabilities"})
    while True:
        response = read_message()
        if "error" in response:
            raise RuntimeError(json.dumps(response["error"], separators=(",", ":")))
        if "return" in response:
            break

    send(command)
    command_complete = False
    event_complete = not expected_event
    while not (command_complete and event_complete):
        response = read_message()
        if "error" in response:
            raise RuntimeError(json.dumps(response["error"], separators=(",", ":")))
        if "return" in response:
            command_complete = True
        if response.get("event") == expected_event:
            device = response.get("data", {}).get("device")
            if not expected_device or device == expected_device:
                event_complete = True
PY
)

  if [[ "$(uname -s)" == "Linux" ]]; then
    sudo "$python" -c "$python_code" "$QMP_SOCKET" "$command" "$expected_event" "$expected_device"
  else
    "$python" -c "$python_code" "$QMP_SOCKET" "$command" "$expected_event" "$expected_device"
  fi
}

qmp_is_available() {
  [[ -S "$QMP_SOCKET" ]] || return 1
  qmp_execute '{"execute":"query-status"}' >/dev/null 2>&1
}

set_usb_connected() {
  local slot="$1"
  local connected="$2"
  local tmp
  tmp=$(mktemp)
  jq ".\"$slot\".connected = $connected" "$USB_STATE_FILE" > "$tmp" && mv "$tmp" "$USB_STATE_FILE"
}

# USB state predates the connected flag, so missing means connected. Preserve
# an explicit false value instead of using jq's // operator, which treats false
# as absent.
get_usb_connected() {
  local slot="$1"
  jq -r ".\"$slot\".connected | if type == \"boolean\" then . else true end" "$USB_STATE_FILE"
}

usb_disconnect() {
  local slot="$1"
  validate_slot "$slot" "$MAX_USB_STORAGE_SLOTS"
  init_state

  local exists connected device_id
  exists=$(jq -r ".\"$slot\".exists // empty" "$USB_STATE_FILE")
  connected=$(get_usb_connected "$slot")
  device_id="usb-storage${slot}"
  if [[ "$exists" != "true" ]]; then
    echo "Error: No USB storage in slot $slot" >&2
    exit 1
  fi
  if [[ "$connected" != "true" ]]; then
    echo "USB storage in slot $slot is already disconnected"
    return
  fi

  if ! qmp_is_available; then
    echo "Error: USB storage can only be disconnected while the VM is running" >&2
    exit 1
  fi
  local command
  command=$(jq -cn --arg id "$device_id" '{execute:"device_del",arguments:{id:$id}}')
  qmp_execute "$command" "DEVICE_DELETED" "$device_id"
  set_usb_connected "$slot" false
  echo "USB storage in slot $slot disconnected (disk image preserved)"
}

usb_connect() {
  local slot="$1"
  validate_slot "$slot" "$MAX_USB_STORAGE_SLOTS"
  init_state

  local exists connected serial device_id
  exists=$(jq -r ".\"$slot\".exists // empty" "$USB_STATE_FILE")
  connected=$(get_usb_connected "$slot")
  serial=$(jq -r ".\"$slot\".serial // \"usb${slot}\"" "$USB_STATE_FILE")
  device_id="usb-storage${slot}"
  if [[ "$exists" != "true" ]]; then
    echo "Error: No USB storage in slot $slot" >&2
    exit 1
  fi
  if [[ "$connected" == "true" ]]; then
    echo "USB storage in slot $slot is already connected"
    return
  fi

  if ! qmp_is_available; then
    echo "Error: USB storage can only be connected while the VM is running" >&2
    exit 1
  fi
  local device bus port command
  device=$(cat "$RUNNING_DEVICE_FILE" 2>/dev/null || true)
  if [[ "$device" == "pi" ]]; then
    if (( slot <= 6 )); then
      bus="usb-bus.0"
      port="1.$(( slot + 1 ))"
    else
      bus="usb-bus.0"
      port="1.8.$(( slot - 6 ))"
    fi
    command=$(jq -cn \
      --arg id "$device_id" --arg drive "usb${slot}" --arg serial "$serial" --arg bus "$bus" --arg port "$port" \
      '{execute:"device_add",arguments:{driver:"usb-storage",id:$id,drive:$drive,serial:$serial,bus:$bus,port:$port}}')
  else
    bus="usb_storage_xhci.0"
    command=$(jq -cn \
      --arg id "$device_id" --arg drive "usb${slot}" --arg serial "$serial" --arg bus "$bus" \
      '{execute:"device_add",arguments:{driver:"usb-storage",id:$id,drive:$drive,serial:$serial,bus:$bus}}')
  fi
  qmp_execute "$command"
  set_usb_connected "$slot" true
  echo "USB storage in slot $slot connected"
}

usb_serial_list() {
  init_state
  echo "USB Serial Adapters:"
  echo "===================="
  echo
  printf "%-6s %-12s %-10s %-20s\n" "Slot" "Status" "Connected" "Serial"
  printf "%-6s %-12s %-10s %-20s\n" "----" "------" "---------" "------"
  for (( slot=1; slot<=MAX_USB_SERIAL_SLOTS; slot++ )); do
    local exists connected serial
    exists=$(jq -r ".\"$slot\".exists // empty" "$USB_SERIAL_STATE_FILE")
    connected=$(jq -r ".\"$slot\".connected // empty" "$USB_SERIAL_STATE_FILE")
    serial=$(jq -r ".\"$slot\".serial // \"(per port)\"" "$USB_SERIAL_STATE_FILE")
    if [[ "$exists" != "true" ]]; then
      printf "%-6s %-12s %-10s %-20s\n" "$slot" "empty" "-" "-"
    elif [[ "$connected" == "true" ]]; then
      printf "%-6s %-12s %-10s %-20s\n" "$slot" "present" "yes" "$serial"
    else
      printf "%-6s %-12s %-10s %-20s\n" "$slot" "unplugged" "no" "$serial"
    fi
  done
  echo
}

usb_serial_add() {
  local slot="$1"
  local serial="$2"
  validate_slot "$slot" "$MAX_USB_SERIAL_SLOTS"
  init_state

  if qmp_is_available; then
    echo "Error: Adding a USB serial adapter while the VM is running is not supported. Power off the VM, add it, then boot it again." >&2
    exit 1
  fi
  if [[ "$(jq -r ".\"$slot\".exists // empty" "$USB_SERIAL_STATE_FILE")" == "true" ]]; then
    echo "Error: USB serial adapter already exists in slot $slot" >&2
    exit 1
  fi

  local tmp
  tmp=$(mktemp)
  jq --arg serial "$serial" \
    ".\"$slot\" = ({\"exists\": true, \"connected\": true} + (if \$serial == \"\" then {} else {\"serial\": \$serial} end))" \
    "$USB_SERIAL_STATE_FILE" > "$tmp" && mv "$tmp" "$USB_SERIAL_STATE_FILE"
  echo "Done. USB serial adapter added to slot $slot"
}

usb_serial_remove() {
  local slot="$1"
  validate_slot "$slot" "$MAX_USB_SERIAL_SLOTS"
  init_state

  if qmp_is_available; then
    echo "Error: Removing a USB serial adapter while the VM is running is not supported. Use 'usb-serial disconnect' instead." >&2
    exit 1
  fi
  local tmp
  tmp=$(mktemp)
  jq "del(.\"$slot\")" "$USB_SERIAL_STATE_FILE" > "$tmp" && mv "$tmp" "$USB_SERIAL_STATE_FILE"
  echo "Done. USB serial adapter removed from slot $slot"
}

# QMP arguments that plug a serial adapter into its slot's port, or the
# keyboard it was swapped for
usb_serial_device_json() {
  local slot="$1"
  local serial
  if [[ "$(jq -r ".\"$slot\".model // empty" "$USB_SERIAL_STATE_FILE")" == "keyboard" ]]; then
    jq -cn --arg id "usb-serial${slot}" --arg port "$slot" '{driver:"usb-kbd",id:$id,bus:"usb_serial_xhci.0",port:$port}'
    return
  fi
  serial=$(jq -r ".\"$slot\".serial // empty" "$USB_SERIAL_STATE_FILE")
  jq -cn --arg id "usb-serial${slot}" --arg chardev "usbserial${slot}" --arg port "$slot" --arg serial "$serial" \
    '{driver:"usb-serial",id:$id,chardev:$chardev,bus:"usb_serial_xhci.0",port:$port} + (if $serial == "" then {} else {serial:$serial} end)'
}

set_usb_serial_connected() {
  local slot="$1"
  local connected="$2"
  local tmp
  tmp=$(mktemp)
  jq ".\"$slot\".connected = $connected" "$USB_SERIAL_STATE_FILE" > "$tmp" && mv "$tmp" "$USB_SERIAL_STATE_FILE"
}

usb_serial_disconnect() {
  local slot="$1"
  validate_slot "$slot" "$MAX_USB_SERIAL_SLOTS"
  init_state

  if [[ "$(jq -r ".\"$slot\".exists // empty" "$USB_SERIAL_STATE_FILE")" != "true" ]]; then
    echo "Error: No USB serial adapter in slot $slot" >&2
    exit 1
  fi
  if [[ "$(jq -r ".\"$slot\".connected" "$USB_SERIAL_STATE_FILE")" != "true" ]]; then
    echo "USB serial adapter in slot $slot is already unplugged"
    return
  fi
  if ! qmp_is_available; then
    echo "Error: USB serial adapters can only be unplugged while the VM is running" >&2
    exit 1
  fi
  local command
  command=$(jq -cn --arg id "usb-serial${slot}" '{execute:"device_del",arguments:{id:$id}}')
  qmp_execute "$command" "DEVICE_DELETED" "usb-serial${slot}"
  set_usb_serial_connected "$slot" false
  echo "USB serial adapter in slot $slot unplugged"
}

usb_serial_connect() {
  local slot="$1"
  validate_slot "$slot" "$MAX_USB_SERIAL_SLOTS"
  init_state

  if [[ "$(jq -r ".\"$slot\".exists // empty" "$USB_SERIAL_STATE_FILE")" != "true" ]]; then
    echo "Error: No USB serial adapter in slot $slot" >&2
    exit 1
  fi
  if [[ "$(jq -r ".\"$slot\".connected" "$USB_SERIAL_STATE_FILE")" == "true" ]]; then
    echo "USB serial adapter in slot $slot is already plugged in"
    return
  fi
  if ! qmp_is_available; then
    echo "Error: USB serial adapters can only be plugged in while the VM is running" >&2
    exit 1
  fi
  qmp_execute "$(jq -cn --argjson arguments "$(usb_serial_device_json "$slot")" '{execute:"device_add",arguments:$arguments}')"
  set_usb_serial_connected "$slot" true
  echo "USB serial adapter in slot $slot plugged in"
}

# Unplug the device in a serial slot and plug in the other model straight away
usb_serial_swap() {
  local slot="$1"
  validate_slot "$slot" "$MAX_USB_SERIAL_SLOTS"
  init_state

  if [[ "$(jq -r ".\"$slot\".exists // empty" "$USB_SERIAL_STATE_FILE")" != "true" ]]; then
    echo "Error: No USB serial adapter in slot $slot" >&2
    exit 1
  fi
  if [[ "$(jq -r ".\"$slot\".connected" "$USB_SERIAL_STATE_FILE")" != "true" ]]; then
    echo "Error: The device in slot $slot is unplugged" >&2
    exit 1
  fi
  if ! qmp_is_available; then
    echo "Error: Devices can only be swapped while the VM is running" >&2
    exit 1
  fi
  qmp_execute "$(jq -cn --arg id "usb-serial${slot}" '{execute:"device_del",arguments:{id:$id}}')" "DEVICE_DELETED" "usb-serial${slot}"
  local tmp
  tmp=$(mktemp)
  jq ".\"$slot\" |= (if .model == \"keyboard\" then del(.model) else .model = \"keyboard\" end)" \
    "$USB_SERIAL_STATE_FILE" > "$tmp" && mv "$tmp" "$USB_SERIAL_STATE_FILE"
  qmp_execute "$(jq -cn --argjson arguments "$(usb_serial_device_json "$slot")" '{execute:"device_add",arguments:$arguments}')"
  echo "Device in slot $slot swapped"
}

usb_net_list() {
  init_state
  echo "USB Network Adapters:"
  echo "====================="
  echo
  printf "%-6s %-12s %-10s\n" "Slot" "Status" "Network"
  printf "%-6s %-12s %-10s\n" "----" "------" "-------"
  for (( slot=1; slot<=MAX_USB_NET_SLOTS; slot++ )); do
    if [[ "$(jq -r ".\"$slot\".exists // empty" "$USB_NET_STATE_FILE")" != "true" ]]; then
      printf "%-6s %-12s %-10s\n" "$slot" "empty" "-"
    elif [[ "$(jq -r ".\"$slot\".connected" "$USB_NET_STATE_FILE")" == "true" ]]; then
      printf "%-6s %-12s %-10s\n" "$slot" "present" "$(usb_net_subnet "$slot")"
    else
      printf "%-6s %-12s %-10s\n" "$slot" "unplugged" "$(usb_net_subnet "$slot")"
    fi
  done
  echo
}

usb_net_subnet() {
  echo "10.0.$(( 10 + $1 )).0/24"
}

usb_net_add() {
  local slot="$1"
  validate_slot "$slot" "$MAX_USB_NET_SLOTS"
  init_state

  if qmp_is_available; then
    echo "Error: Adding a USB network adapter while the VM is running is not supported. Power off the VM, add it, then boot it again." >&2
    exit 1
  fi
  if [[ "$(jq -r ".\"$slot\".exists // empty" "$USB_NET_STATE_FILE")" == "true" ]]; then
    echo "Error: USB network adapter already exists in slot $slot" >&2
    exit 1
  fi
  local tmp
  tmp=$(mktemp)
  jq ".\"$slot\" = {\"exists\": true, \"connected\": true}" "$USB_NET_STATE_FILE" > "$tmp" && mv "$tmp" "$USB_NET_STATE_FILE"
  echo "Done. USB network adapter added to slot $slot"
}

usb_net_remove() {
  local slot="$1"
  validate_slot "$slot" "$MAX_USB_NET_SLOTS"
  init_state

  if qmp_is_available; then
    echo "Error: Removing a USB network adapter while the VM is running is not supported. Use 'usb-net disconnect' instead." >&2
    exit 1
  fi
  local tmp
  tmp=$(mktemp)
  jq "del(.\"$slot\")" "$USB_NET_STATE_FILE" > "$tmp" && mv "$tmp" "$USB_NET_STATE_FILE"
  echo "Done. USB network adapter removed from slot $slot"
}

# QMP arguments that plug a network adapter into its slot's port
usb_net_device_json() {
  local slot="$1"
  jq -cn --arg id "usb-net${slot}" --arg netdev "usbnet${slot}" --arg port "$slot" \
    '{driver:"usb-net",id:$id,netdev:$netdev,bus:"usb_net_xhci.0",port:$port}'
}

set_usb_net_connected() {
  local slot="$1"
  local connected="$2"
  local tmp
  tmp=$(mktemp)
  jq ".\"$slot\".connected = $connected" "$USB_NET_STATE_FILE" > "$tmp" && mv "$tmp" "$USB_NET_STATE_FILE"
}

usb_net_disconnect() {
  local slot="$1"
  validate_slot "$slot" "$MAX_USB_NET_SLOTS"
  init_state

  if [[ "$(jq -r ".\"$slot\".exists // empty" "$USB_NET_STATE_FILE")" != "true" ]]; then
    echo "Error: No USB network adapter in slot $slot" >&2
    exit 1
  fi
  if [[ "$(jq -r ".\"$slot\".connected" "$USB_NET_STATE_FILE")" != "true" ]]; then
    echo "USB network adapter in slot $slot is already unplugged"
    return
  fi
  if ! qmp_is_available; then
    echo "Error: USB network adapters can only be unplugged while the VM is running" >&2
    exit 1
  fi
  qmp_execute "$(jq -cn --arg id "usb-net${slot}" '{execute:"device_del",arguments:{id:$id}}')" "DEVICE_DELETED" "usb-net${slot}"
  set_usb_net_connected "$slot" false
  echo "USB network adapter in slot $slot unplugged"
}

usb_net_connect() {
  local slot="$1"
  validate_slot "$slot" "$MAX_USB_NET_SLOTS"
  init_state

  if [[ "$(jq -r ".\"$slot\".exists // empty" "$USB_NET_STATE_FILE")" != "true" ]]; then
    echo "Error: No USB network adapter in slot $slot" >&2
    exit 1
  fi
  if [[ "$(jq -r ".\"$slot\".connected" "$USB_NET_STATE_FILE")" == "true" ]]; then
    echo "USB network adapter in slot $slot is already plugged in"
    return
  fi
  if ! qmp_is_available; then
    echo "Error: USB network adapters can only be plugged in while the VM is running" >&2
    exit 1
  fi
  qmp_execute "$(jq -cn --argjson arguments "$(usb_net_device_json "$slot")" '{execute:"device_add",arguments:$arguments}')"
  set_usb_net_connected "$slot" true
  echo "USB network adapter in slot $slot plugged in"
}

# Build QEMU arguments for USB network adapters. Each keeps its own user-mode
# network, with a DHCP server, so an unplugged one can be plugged back in.
# Arguments: <device>
build_usb_net_args() {
  local device="$1"
  local args=""
  for (( slot=1; slot<=MAX_USB_NET_SLOTS; slot++ )); do
    [[ "$(jq -r ".\"$slot\".exists // empty" "$USB_NET_STATE_FILE")" == "true" ]] || continue
    if [[ "$device" == "pi" ]]; then
      echo "Error: USB network adapters are not supported on the pi device" >&2
      exit 1
    fi
    if [[ -z "$args" ]]; then
      args="-device qemu-xhci,id=usb_net_xhci"
    fi
    args="$args -netdev user,id=usbnet${slot},net=$(usb_net_subnet "$slot")"
    if [[ "$(jq -r ".\"$slot\".connected" "$USB_NET_STATE_FILE")" == "true" ]]; then
      args="$args -device $(usb_net_device_json "$slot" | jq -r 'to_entries | map(if .key == "driver" then .value else "\(.key)=\(.value)" end) | join(",")')"
    fi
  done
  echo "$args"
}

# Build QEMU arguments for USB serial adapters. Every adapter keeps its own
# character backend so an unplugged one can be plugged back in. usb-serial only
# attaches once its backend reports being open, which a null backend never does,
# so use an in-memory ring buffer.
# Arguments: <device>
build_usb_serial_args() {
  local device="$1"
  local args=""
  for (( slot=1; slot<=MAX_USB_SERIAL_SLOTS; slot++ )); do
    [[ "$(jq -r ".\"$slot\".exists // empty" "$USB_SERIAL_STATE_FILE")" == "true" ]] || continue
    if [[ "$device" == "pi" ]]; then
      echo "Error: USB serial adapters are not supported on the pi device" >&2
      exit 1
    fi
    if [[ -z "$args" ]]; then
      args="-device qemu-xhci,id=usb_serial_xhci"
    fi
    args="$args -chardev ringbuf,id=usbserial${slot}"
    if [[ "$(jq -r ".\"$slot\".connected" "$USB_SERIAL_STATE_FILE")" == "true" ]]; then
      args="$args -device $(usb_serial_device_json "$slot" | jq -r 'to_entries | map(if .key == "driver" then .value else "\(.key)=\(.value)" end) | join(",")')"
    fi
  done
  echo "$args"
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

# Build QEMU SAS arguments for connected devices (SCSI disks behind an LSI SAS HBA, the
# same Fusion-MPT family as the SAS2008/SAS3008 cards common in DIY NAS builds)
build_sas_args() {
  local sas_args=""
  local has_sas=false

  for (( slot=1; slot<=MAX_SAS_SLOTS; slot++ )); do
    local exists connected
    exists=$(jq -r ".\"$slot\".exists // empty" "$SAS_STATE_FILE")
    connected=$(jq -r ".\"$slot\".connected // empty" "$SAS_STATE_FILE")

    if [[ "$exists" == "true" && "$connected" == "true" ]]; then
      local disk_path serial wwn ssd rotation_rate
      disk_path=$(get_sas_disk_path "$slot")
      serial=$(jq -r ".\"$slot\".serial // \"sas${slot}\"" "$SAS_STATE_FILE")
      wwn=$(jq -r ".\"$slot\".wwn" "$SAS_STATE_FILE")
      ssd=$(jq -r ".\"$slot\".ssd // false" "$SAS_STATE_FILE")
      rotation_rate=7200
      if [[ "$ssd" == "true" ]]; then
        # SCSI medium rotation rate of 1 indicates non-rotational media (SSD).
        rotation_rate=1
      fi

      # Add the HBA on first SAS device
      if [[ "$has_sas" == "false" ]]; then
        sas_args="$sas_args -device mptsas1068,id=sas"
        has_sas=true
      fi

      sas_args="$sas_args -drive file=${disk_path},format=qcow2,if=none,id=sas${slot},cache=none,discard=unmap,aio=threads"
      sas_args="$sas_args -device scsi-hd,drive=sas${slot},bus=sas.0,scsi-id=$(( slot - 1 )),serial=${serial},wwn=${wwn},rotation_rate=${rotation_rate}"
    fi
  done

  echo "$sas_args"
}

# Build QEMU USB storage arguments for existing devices
# Arguments: <device>
build_usb_args() {
  local device="$1"
  local usb_args=""
  local has_usb_storage=false

  for (( slot=1; slot<=MAX_USB_STORAGE_SLOTS; slot++ )); do
    local exists connected
    exists=$(jq -r ".\"$slot\".exists // empty" "$USB_STATE_FILE")
    connected=$(get_usb_connected "$slot")

    if [[ "$exists" == "true" ]]; then
      local disk_path serial bus_arg=""
      disk_path=$(get_usb_disk_path "$slot")
      serial=$(jq -r ".\"$slot\".serial // empty" "$USB_STATE_FILE")
      if [[ -z "$serial" ]]; then
        serial="usb${slot}"
      fi

      if [[ "$has_usb_storage" == "false" ]]; then
        if [[ "$device" != "pi" ]]; then
          usb_args="$usb_args -device qemu-xhci,id=usb_storage_xhci"
        fi
        has_usb_storage=true
      fi

      if [[ "$device" == "pi" ]]; then
        # The Pi VM's USB devices share its single dwc2 root port through two
        # emulated hubs. Port 1.1 is reserved for networking; slots 1-6 use the
        # first hub and slots 7-8 use the nested hub on port 1.8.
        if (( slot <= 6 )); then
          bus_arg=",bus=usb-bus.0,port=1.$(( slot + 1 ))"
        else
          bus_arg=",bus=usb-bus.0,port=1.8.$(( slot - 6 ))"
        fi
      else
        bus_arg=",bus=usb_storage_xhci.0"
      fi

      # Keep the named block nodes alive when device_del removes the USB device
      # so usb connect can attach the same backing disk again.
      usb_args="$usb_args -blockdev driver=file,node-name=usb${slot}-file,filename=${disk_path},cache.direct=on,cache.no-flush=off,aio=threads"
      usb_args="$usb_args -blockdev driver=qcow2,node-name=usb${slot},file=usb${slot}-file,discard=unmap"
      if [[ "$connected" == "true" ]]; then
        usb_args="$usb_args -device usb-storage${bus_arg},id=usb-storage${slot},drive=usb${slot},serial=${serial}"
      fi
    fi
  done

  echo "$usb_args"
}

# Build QEMU NVMe arguments for connected devices
# Arguments: <device> [boot-slot]
build_nvme_args() {
  local device="$1"
  local boot_slot="${2:-}"
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

      # Boot from this NVMe if requested (e.g. after the USB installer
      # flashed an OS onto it)
      local bootindex_arg=""
      if [[ -n "$boot_slot" && "$slot" == "$boot_slot" ]]; then
        bootindex_arg=",bootindex=0"
      fi

      nvme_args="$nvme_args -device pcie-root-port,id=rp${slot},slot=${pci_slot},chassis=${slot}"
      nvme_args="$nvme_args -drive file=${disk_path},format=qcow2,if=none,id=nvme${slot},cache=none,discard=unmap,aio=threads"
      nvme_args="$nvme_args -device nvme,drive=nvme${slot},serial=${serial},bus=rp${slot}${bootindex_arg}"
    fi
  done

  echo "$nvme_args"
}

# Build QEMU arguments for the boot disk.
# Arguments: <overlay> <boot-disk-transport>
build_boot_disk_args() {
  local overlay="$1"
  local boot_disk_transport="$2"
  local drive_args="file=${overlay},if=none,id=boot,format=qcow2,cache=none,discard=unmap,aio=threads"

  case "$boot_disk_transport" in
    none)
      # No boot disk, e.g. an unflashed device booting the USB installer.
      echo ""
      ;;
    emmc)
      # eMMC is emulated with virtio-blk for VM tests.
      echo "-drive ${drive_args} -device virtio-blk-pci,drive=boot,bootindex=0"
      ;;
    nvme)
      echo "-drive ${drive_args} -device nvme,drive=boot,serial=umbrel-boot-nvme,bootindex=0"
      ;;
    usb)
      echo "-device qemu-xhci,id=boot_xhci -drive ${drive_args} -device usb-storage,bus=boot_xhci.0,drive=boot,serial=umbrel-boot-usb,bootindex=0"
      ;;
    sdcard)
      # Attaches to the SD bus of machines that have one (e.g. raspi4b).
      echo "-drive file=${overlay},if=sd,format=qcow2"
      ;;
    *)
      echo "Error: Unknown boot disk transport: $boot_disk_transport" >&2
      exit 1
      ;;
  esac
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

# Extract the Raspberry Pi 4 kernel, initramfs, device tree and kernel cmdline
# from the boot partition of the Pi image. QEMU doesn't emulate the Pi's GPU
# boot firmware so we direct-boot these with -kernel/-initrd/-dtb instead,
# the same files the firmware would load on real hardware.
#
# Note this always reads the pristine image, not the VM's disk overlay, so
# changes the booted OS makes to its boot partition (e.g. the UAS quirk
# writer editing cmdline.txt, or an OS update switching slots) are NOT
# picked up by a VM reboot the way they would be on real hardware.
extract_pi_boot_files() {
  local image="$1"
  local boot_dir="$2"

  local mcopy sfdisk fdtput
  mcopy=$(find_command mcopy /opt/homebrew/bin/mcopy /usr/local/bin/mcopy)
  sfdisk=$(find_command sfdisk /opt/homebrew/opt/util-linux/sbin/sfdisk /usr/local/opt/util-linux/sbin/sfdisk)
  fdtput=$(find_command fdtput /opt/homebrew/bin/fdtput /usr/local/bin/fdtput)

  # Find the offset of the boot partition (partition 2) in the image.
  local sfdisk_dump sector_size boot_start boot_image
  sfdisk_dump=$("$sfdisk" -d "$image")
  sector_size=$(awk '/^sector-size:/ {print $2}' <<< "$sfdisk_dump")
  boot_start=$(awk -v partition="${image}2" '$1 == partition {sub(/.*start= */, ""); sub(/,.*/, ""); print}' <<< "$sfdisk_dump")
  if [[ -z "$boot_start" ]]; then
    echo "Error: Could not find Pi image boot partition 2 in $image" >&2
    exit 1
  fi
  boot_image="${image}@@$((boot_start * ${sector_size:-512}))"

  rm -rf "$boot_dir"
  mkdir -p "$boot_dir"
  if ! MTOOLS_SKIP_CHECK=1 "$mcopy" -o -i "$boot_image" ::kernel8.img ::initramfs8 ::bcm2711-rpi-4-b.dtb ::cmdline.txt "$boot_dir/" >/dev/null; then
    echo "Error: Could not extract Pi 4 boot files from the image boot partition" >&2
    exit 1
  fi

  # Enable the Pi's dwc2 USB controller in host mode. It's disabled in the stock
  # device tree (the firmware enables it on real hardware when needed) and it's
  # the only USB controller QEMU emulates, the USB-A ports behind the PCIe xHCI
  # controller don't exist in the VM.
  "$fdtput" -t s "$boot_dir/bcm2711-rpi-4-b.dtb" /soc/usb@7e980000 status okay
  "$fdtput" -t s "$boot_dir/bcm2711-rpi-4-b.dtb" /soc/usb@7e980000 dr_mode host

  # QEMU attaches the SD card to the legacy SDHCI controller instead of the
  # EMMC2 controller that drives the SD slot on a real Pi 4. Swap their mmc
  # aliases so the SD card is still named mmcblk0 like on real hardware
  # (umbrelOS uses that to detect it's booting from an SD card).
  "$fdtput" -t s "$boot_dir/bcm2711-rpi-4-b.dtb" /aliases mmc0 /soc/mmcnr@7e300000
  "$fdtput" -t s "$boot_dir/bcm2711-rpi-4-b.dtb" /aliases mmc1 /emmc2bus/mmc@7e340000
}

prepare_pi_cmdline() {
  local boot_dir="$1"
  local cmdline
  cmdline=$(tr '\r\n' '  ' < "$boot_dir/cmdline.txt" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')

  # The kernel can't resolve the serial0 alias in console=, on real hardware
  # the firmware rewrites it to the real device (ttyS0, the Pi 4 mini-UART)
  # while loading the cmdline. Do the same, and move it last so the serial
  # console becomes /dev/console and full boot output is visible in the VM's
  # stdio rather than on the invisible tty1.
  cmdline=$(sed -E 's/console=serial0(,[0-9]+)? //' <<< "$cmdline")
  cmdline="${cmdline} console=ttyS0,115200"

  # QEMU's USB NIC uses the same USB ID as an OpenBMC host link. Newer udev
  # classifies that ID as link-local-only, so NetworkManager does not request
  # the DHCP address required by QEMU's user-mode networking and port forwards.
  # Acquire the address in the initramfs before userspace applies that policy.
  cmdline="${cmdline} ip=dhcp"

  echo "$cmdline"
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
  local boot_disk_transport="$9"
  local cdrom_iso="${10}"
  local boot_nvme_slot="${11}"
  shift 11
  local forward_ports=("$@")

  if [[ -n "$cdrom_iso" && -n "$boot_nvme_slot" ]]; then
    echo "Error: --cdrom and --boot-nvme-slot are mutually exclusive (both claim first boot priority)" >&2
    exit 1
  fi

  init_state

  if [[ "$boot_disk_transport" != "none" && ! -f "$image" ]]; then
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

  # With --boot-disk none the image may not exist (e.g. an unflashed device
  # booting the USB installer), so only resolve its path when it's used.
  local image_abs=""
  if [[ "$boot_disk_transport" != "none" ]]; then
    image_abs="$(cd "$(dirname "$image")" && pwd)/$(basename "$image")"
  fi

  # Setup overlay disk
  local overlay="$STATE_DIR/overlay-${arch}.qcow2"
  if [[ "$device" == "pi" ]]; then
    overlay="$STATE_DIR/overlay-pi.qcow2"
  fi
  if [[ "$boot_disk_transport" == "none" ]]; then
    : # No boot disk, no overlay needed
  elif [[ ! -f "$overlay" ]]; then
    echo "Creating overlay image..."
    qemu-img create -f qcow2 -F raw -b "$image_abs" "$overlay" "$disk_size" >/dev/null
  else
    echo "Using existing overlay image"
  fi

  # Device-specific SMBIOS and default boot disk settings
  local smbios_args default_boot_disk_transport
  case "$device" in
    umbrel-home)
      smbios_args=(-smbios "type=1,manufacturer=Umbrel,, Inc.,product=Umbrel Home,sku=U130122,family=NAS")
      # Umbrel Home has no eMMC — the OS lives on the NVMe SSD
      default_boot_disk_transport="nvme"
      ;;
    umbrel-pro)
      smbios_args=(-smbios "type=1,manufacturer=Umbrel,, Inc.,product=Umbrel Pro,sku=U4XN1,family=NAS")
      # Umbrel Pro boots from eMMC (virtio-blk), NVMe slots are for data SSDs
      default_boot_disk_transport="emmc"
      ;;
    nas)
      smbios_args=(-smbios "type=1,manufacturer=Generic,product=NAS,family=NAS")
      # Generic NAS boots from eMMC (virtio-blk), has NVMe and SATA slots for storage
      default_boot_disk_transport="emmc"
      ;;
    pi)
      # The Pi has no SMBIOS, umbrelOS detects Pi hardware from the device
      # tree model exposed in /proc/cpuinfo.
      smbios_args=()
      # The Pi boots from an SD card.
      default_boot_disk_transport="sdcard"
      ;;
  esac

  if [[ "$boot_disk_transport" == "default" ]]; then
    boot_disk_transport="$default_boot_disk_transport"
  fi

  if [[ "$device" == "pi" && "$boot_disk_transport" != "sdcard" ]]; then
    echo "Error: pi VM requires --boot-disk sdcard" >&2
    exit 1
  fi

  local boot_disk_args
  boot_disk_args=$(build_boot_disk_args "$overlay" "$boot_disk_transport")

  local firmware_args=()
  local direct_boot_args=()
  if [[ "$device" == "pi" ]]; then
    local pi_boot_dir pi_cmdline
    pi_boot_dir="$STATE_DIR/pi-boot"
    extract_pi_boot_files "$image_abs" "$pi_boot_dir"
    pi_cmdline=$(prepare_pi_cmdline "$pi_boot_dir")
    direct_boot_args=(-dtb "$pi_boot_dir/bcm2711-rpi-4-b.dtb" -kernel "$pi_boot_dir/kernel8.img" -initrd "$pi_boot_dir/initramfs8" -append "$pi_cmdline")
  else
    detect_uefi_firmware "$arch"

    # Setup UEFI VARS
    local uefi_vars="$STATE_DIR/uefi-vars-${arch}.fd"
    if [[ ! -f "$uefi_vars" ]]; then
      cp "$UEFI_VARS_TEMPLATE" "$uefi_vars"
    fi
    firmware_args=(-drive "if=pflash,format=raw,readonly=on,file=$UEFI_CODE" -drive "if=pflash,format=raw,file=$uefi_vars")
  fi

  # Attach a bootable CD-ROM if requested (e.g. the USB installer ISO). The
  # ide-cd device plugs into the q35 machine's built-in SATA controller which
  # only exists on amd64.
  local cdrom_args=""
  if [[ -n "$cdrom_iso" ]]; then
    if [[ "$arch" != "amd64" ]]; then
      echo "Error: --cdrom is only supported on amd64" >&2
      exit 1
    fi
    if [[ ! -f "$cdrom_iso" ]]; then
      echo "Error: CD-ROM image not found: $cdrom_iso" >&2
      exit 1
    fi
    cdrom_args="-drive file=${cdrom_iso},media=cdrom,if=none,id=cdrom0,format=raw,readonly=on"
    cdrom_args="$cdrom_args -device ide-cd,drive=cdrom0,bootindex=0"
  fi

  # Build disk arguments for data drives
  local nvme_args hdd_args sas_args usb_args usb_serial_args usb_net_args
  nvme_args=$(build_nvme_args "$device" "$boot_nvme_slot")
  hdd_args=$(build_hdd_args)
  sas_args=$(build_sas_args)
  usb_args=$(build_usb_args "$device")
  usb_serial_args=$(build_usb_serial_args "$device")
  usb_net_args=$(build_usb_net_args "$device")

  # Platform and architecture-specific settings
  local accel_args machine_args cpu_args
  local qemu_sudo=""

  if [[ "$device" == "pi" ]]; then
    # QEMU's raspi4b machine emulates the BCM2711's fixed Cortex-A72 cores so
    # hardware virtualisation can't be used, even on ARM64 hosts.
    accel_args="-accel tcg"
    cpu_args=""
    machine_args="-machine raspi4b"
  elif [[ "$arch" == "arm64" ]]; then
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

  # The Pi has no PCI bus for a virtio NIC, networking attaches to the Pi's
  # dwc2 USB controller instead. The Pi console (serial0 in cmdline.txt) is the
  # mini-UART, which is the second serial device on QEMU raspi machines (the
  # first is the PL011, which is reserved for Bluetooth).
  local network_device="virtio-net-pci"
  local pi_usb_hub_args=""
  local serial_args="-serial chardev:char0"
  if [[ "$device" == "pi" ]]; then
    network_device="usb-net"
    serial_args="-serial null -serial chardev:char0"
    if [[ -n "$usb_args" ]]; then
      pi_usb_hub_args="-device usb-hub,id=usb_storage_hub,bus=usb-bus.0,port=1"
      pi_usb_hub_args="$pi_usb_hub_args -device usb-hub,id=usb_storage_hub_overflow,bus=usb-bus.0,port=1.8"
      network_device="usb-net,bus=usb-bus.0,port=1.1"
    fi
  fi

  echo "Booting VM (${arch}, ${device}, ${boot_disk_transport} boot disk)..."
  echo "  SSH: ssh -p ${ssh_port} umbrel@localhost"
  echo "  HTTP: http://localhost:${http_port}"
  # ${arr[@]+...} guard: empty array expansion errors under set -u on bash < 4.4 (stock macOS bash 3.2)
  for port_forward in ${forward_ports[@]+"${forward_ports[@]}"}; do
    echo "  TCP ${port_forward#*:}: localhost:${port_forward%%:*}"
  done
  echo

  remove_qmp_socket
  printf '%s\n' "$device" > "$RUNNING_DEVICE_FILE"

  local netdev_arg="user,id=net0,hostfwd=tcp:127.0.0.1:${ssh_port}-:22,hostfwd=tcp:127.0.0.1:${http_port}-:80"
  # ${arr[@]+...} guard: empty array expansion errors under set -u on bash < 4.4 (stock macOS bash 3.2)
  for port_forward in ${forward_ports[@]+"${forward_ports[@]}"}; do
    netdev_arg="${netdev_arg},hostfwd=tcp:127.0.0.1:${port_forward%%:*}-:${port_forward#*:}"
  done

  # shellcheck disable=SC2086
  exec $qemu_sudo "$qemu_binary" \
    $accel_args \
    $machine_args \
    $cpu_args \
    -smp "$cores" \
    -m "$memory" \
    -rtc base=utc \
    -qmp "unix:${QMP_SOCKET},server=on,wait=off" \
    -nographic -monitor none -chardev stdio,id=char0,signal=off $serial_args \
    "${smbios_args[@]}" \
    "${firmware_args[@]}" \
    ${direct_boot_args[@]+"${direct_boot_args[@]}"} \
    $boot_disk_args \
    $cdrom_args \
    -netdev "$netdev_arg" \
    $pi_usb_hub_args \
    -device ${network_device},netdev=net0 \
    $nvme_args \
    $hdd_args \
    $sas_args \
    $usb_args \
    $usb_serial_args \
    $usb_net_args
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
  local pi_overlay="$STATE_DIR/overlay-pi.qcow2"
  if [[ -f "$pi_overlay" ]]; then
    echo "Removing pi boot disk overlay..."
    rm -f "$pi_overlay"
    found=true
  fi
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

# Press the power button (sends an ACPI power button event to the guest)
press_power_button() {
  initialize_qmp_socket
  if ! qmp_is_available; then
    echo "Error: The power button can only be pressed while the VM is running" >&2
    exit 1
  fi
  qmp_execute '{"execute":"system_powerdown"}'
  echo "Power button pressed"
}

# Reset all state
reset_state() {
  remove_qmp_socket
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

  power-button)
    press_power_button
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

  sata|sas)
    bus="$command"
    if [[ $# -lt 1 ]]; then
      echo "Error: $bus requires a subcommand" >&2
      echo "Usage: $0 $bus <list|add|destroy|connect|disconnect|move> [args]" >&2
      exit 1
    fi

    subcommand="$1"
    shift

    case "$subcommand" in
      list)
        if [[ "$bus" == "sas" ]]; then sas_list; else sata_list; fi
        ;;
      add)
        if [[ $# -lt 1 ]]; then
          echo "Error: $bus add requires a slot number" >&2
          exit 1
        fi
        slot="$1"
        shift
        size="$DEFAULT_HDD_SIZE"
        drive_type="hdd"
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --size)
              size="$2"
              shift 2
              ;;
            --type)
              drive_type="$2"
              shift 2
              ;;
            *)
              echo "Error: Unknown option: $1" >&2
              exit 1
              ;;
          esac
        done
        if [[ "$drive_type" != "hdd" && "$drive_type" != "ssd" ]]; then
          echo "Error: --type must be one of: hdd, ssd" >&2
          exit 1
        fi
        bay_add "$bus" "$slot" "$size" "$drive_type"
        ;;
      destroy)
        if [[ $# -lt 1 ]]; then
          echo "Error: $bus destroy requires a slot number" >&2
          exit 1
        fi
        hdd_destroy "$bus" "$1"
        ;;
      connect)
        if [[ $# -lt 1 ]]; then
          echo "Error: $bus connect requires a slot number" >&2
          exit 1
        fi
        hdd_connect "$bus" "$1"
        ;;
      disconnect)
        if [[ $# -lt 1 ]]; then
          echo "Error: $bus disconnect requires a slot number" >&2
          exit 1
        fi
        hdd_disconnect "$bus" "$1"
        ;;
      move)
        if [[ $# -lt 2 ]]; then
          echo "Error: $bus move requires source and destination slot numbers" >&2
          echo "Usage: $0 $bus move <from-slot> <to-slot>" >&2
          exit 1
        fi
        hdd_move "$bus" "$1" "$2"
        ;;
      *)
        echo "Error: Unknown $bus subcommand: $subcommand" >&2
        echo "Usage: $0 $bus <list|add|destroy|connect|disconnect|move> [args]" >&2
        exit 1
        ;;
    esac
    exit 0
    ;;

  usb)
    if [[ $# -lt 1 ]]; then
      echo "Error: usb requires a subcommand" >&2
      echo "Usage: $0 usb <list|add|destroy|connect|disconnect> [args]" >&2
      exit 1
    fi

    subcommand="$1"
    shift

    case "$subcommand" in
      list)
        usb_list
        ;;
      add)
        if [[ $# -lt 1 ]]; then
          echo "Error: usb add requires a slot number" >&2
          exit 1
        fi
        slot="$1"
        shift
        size="$DEFAULT_USB_STORAGE_SIZE"
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
        usb_add "$slot" "$size"
        ;;
      destroy)
        if [[ $# -lt 1 ]]; then
          echo "Error: usb destroy requires a slot number" >&2
          exit 1
        fi
        usb_destroy "$1"
        ;;
      connect)
        if [[ $# -lt 1 ]]; then
          echo "Error: usb connect requires a slot number" >&2
          exit 1
        fi
        usb_connect "$1"
        ;;
      disconnect)
        if [[ $# -lt 1 ]]; then
          echo "Error: usb disconnect requires a slot number" >&2
          exit 1
        fi
        usb_disconnect "$1"
        ;;
      *)
        echo "Error: Unknown usb subcommand: $subcommand" >&2
        echo "Usage: $0 usb <list|add|destroy|connect|disconnect> [args]" >&2
        exit 1
        ;;
    esac
    exit 0
    ;;

  usb-serial)
    if [[ $# -lt 2 ]]; then
      [[ "${1:-}" == "list" ]] && { usb_serial_list; exit 0; }
      echo "Usage: $0 usb-serial <list|add|remove|connect|disconnect|swap> <slot> [--serial SERIAL]" >&2
      exit 1
    fi
    subcommand="$1"
    slot="$2"
    shift 2
    case "$subcommand" in
      add)
        serial=""
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --serial)
              serial="$2"
              shift 2
              ;;
            *)
              echo "Error: Unknown option: $1" >&2
              exit 1
              ;;
          esac
        done
        usb_serial_add "$slot" "$serial"
        ;;
      remove) usb_serial_remove "$slot" ;;
      connect) usb_serial_connect "$slot" ;;
      disconnect) usb_serial_disconnect "$slot" ;;
      swap) usb_serial_swap "$slot" ;;
      *)
        echo "Error: Unknown usb-serial subcommand: $subcommand" >&2
        exit 1
        ;;
    esac
    exit 0
    ;;

  usb-net)
    if [[ $# -lt 2 ]]; then
      [[ "${1:-}" == "list" ]] && { usb_net_list; exit 0; }
      echo "Usage: $0 usb-net <list|add|remove|connect|disconnect> <slot>" >&2
      exit 1
    fi
    subcommand="$1"
    slot="$2"
    case "$subcommand" in
      add) usb_net_add "$slot" ;;
      remove) usb_net_remove "$slot" ;;
      connect) usb_net_connect "$slot" ;;
      disconnect) usb_net_disconnect "$slot" ;;
      *)
        echo "Error: Unknown usb-net subcommand: $subcommand" >&2
        exit 1
        ;;
    esac
    exit 0
    ;;

  boot)
    image=""
    arch=""
    device="$DEFAULT_DEVICE"
    boot_disk_transport="default"
    cdrom_iso=""
    boot_nvme_slot=""
    memory="$DEFAULT_MEMORY"
    cores="$DEFAULT_CORES"
    disk_size=""
    ssh_port="$DEFAULT_SSH_PORT"
    http_port="$DEFAULT_HTTP_PORT"
    forward_ports=()

    # Check if first argument is an image path (not an option)
    if [[ $# -gt 0 && ! "$1" =~ ^-- ]]; then
      image="$1"
      shift
    fi

    while [[ $# -gt 0 ]]; do
      case "$1" in
        --device)
          device="$2"
          if [[ "$device" != "umbrel-pro" && "$device" != "umbrel-home" && "$device" != "nas" && "$device" != "pi" ]]; then
            echo "Error: --device must be 'umbrel-pro', 'umbrel-home', 'nas', or 'pi'" >&2
            exit 1
          fi
          shift 2
          ;;
        --boot-disk)
          boot_disk_transport="$2"
          if [[ "$boot_disk_transport" != "default" && "$boot_disk_transport" != "emmc" && "$boot_disk_transport" != "nvme" && "$boot_disk_transport" != "usb" && "$boot_disk_transport" != "sdcard" && "$boot_disk_transport" != "none" ]]; then
            echo "Error: --boot-disk must be 'default', 'emmc', 'nvme', 'usb', 'sdcard', or 'none'" >&2
            exit 1
          fi
          shift 2
          ;;
        --cdrom)
          cdrom_iso="$2"
          shift 2
          ;;
        --boot-nvme-slot)
          boot_nvme_slot="$2"
          validate_slot "$boot_nvme_slot"
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
        --forward-port)
          if [[ ! "$2" =~ ^[0-9]+:[0-9]+$ ]]; then
            echo "Error: --forward-port must be in host:guest format" >&2
            exit 1
          fi
          forward_ports+=("$2")
          shift 2
          ;;
        *)
          echo "Error: Unknown option: $1" >&2
          exit 1
          ;;
      esac
    done

    if [[ "$device" == "pi" && -n "$arch" && "$arch" != "arm64" ]]; then
      echo "Error: pi VM requires --arch arm64" >&2
      exit 1
    fi

    if [[ -z "$disk_size" ]]; then
      if [[ "$device" == "pi" ]]; then
        disk_size="$DEFAULT_PI_DISK_SIZE"
      else
        disk_size="$DEFAULT_DISK_SIZE"
      fi
    fi

    # If no image specified, infer from architecture or device
    if [[ -z "$image" ]]; then
      if [[ "$device" == "pi" ]]; then
        arch="arm64"
        image=$(get_default_pi_image)
      else
        # If arch not specified, use native arch
        if [[ -z "$arch" ]]; then
          arch=$(get_native_arch)
          echo "Using native architecture: $arch"
        fi
        image=$(get_default_image "$arch")
      fi
      echo "Using default image: $image"
    else
      if [[ "$device" == "pi" ]]; then
        arch="arm64"
      elif [[ -z "$arch" ]]; then
        # Image specified - auto-detect architecture if not specified
        arch=$(detect_arch "$image")
        echo "Auto-detected architecture: $arch"
      fi
    fi

    # ${arr[@]+...} guard: empty array expansion errors under set -u on bash < 4.4 (stock macOS bash 3.2)
    boot_vm "$image" "$arch" "$device" "$memory" "$cores" "$disk_size" "$ssh_port" "$http_port" "$boot_disk_transport" "$cdrom_iso" "$boot_nvme_slot" ${forward_ports[@]+"${forward_ports[@]}"}
    ;;

  *)
    echo "Error: Unknown command: $command" >&2
    show_help
    exit 1
    ;;
esac
