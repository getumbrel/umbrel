#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${VM_STATE_DIR:-$SCRIPT_DIR/vm-state}"
NVME_STATE_FILE="$STATE_DIR/nvme.json"

# PCIe Physical Slot Numbers that match Umbrel Pro hardware
# Maps slot 1-4 to their respective PCIe slot numbers
declare -A PCI_SLOT_MAP=([1]=12 [2]=14 [3]=4 [4]=6)

# Defaults
DEFAULT_MEMORY=2048
DEFAULT_CORES=4
DEFAULT_DISK_SIZE="64G"
DEFAULT_SSH_PORT=2222
DEFAULT_HTTP_PORT=8080
DEFAULT_NVME_SIZE="64G"

show_help() {
  cat << EOF
vm.sh - Manage an umbrelOS QEMU virtual machine

Usage: $0 <command> [options]

Commands:
    boot <image>                   Boot VM from the given image
    reflash                        Delete boot disk overlay (simulates reflashing the OS)
    reset                          Delete all VM state (overlay, NVMe disks, UEFI vars)

    nvme list                      List all NVMe devices and their status
    nvme add <slot> [--size SIZE]  Add an NVMe device to slot (1-4)
    nvme destroy <slot>            Destroy an NVMe device (deletes data)
    nvme connect <slot>            Connect an existing NVMe device to the VM
    nvme disconnect <slot>         Disconnect an NVMe device from the VM

Boot Options:
    --memory <MiB>                 RAM in MiB (default: ${DEFAULT_MEMORY})
    --cores <count>                CPU cores (default: ${DEFAULT_CORES})
    --disk-size <size>             Boot disk size (default: ${DEFAULT_DISK_SIZE})
    --ssh-port <port>              Local SSH port forward (default: ${DEFAULT_SSH_PORT})
    --http-port <port>             Local HTTP port forward (default: ${DEFAULT_HTTP_PORT})

NVMe Options:
    --size <size>                  NVMe disk size (default: ${DEFAULT_NVME_SIZE})

Environment Variables:
    VM_STATE_DIR                   Override state directory (default: ./vm-state)

Examples:
    $0 boot umbrelos.img --memory 4096 --cores 8
    $0 nvme add 1 --size 128G
    $0 nvme add 2
    $0 nvme disconnect 2
    $0 nvme list

EOF
}

# Initialize state directory and NVMe state file
init_state() {
  mkdir -p "$STATE_DIR"
  if [[ ! -f "$NVME_STATE_FILE" ]]; then
    echo '{}' > "$NVME_STATE_FILE"
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
  if [[ ! "$slot" =~ ^[1-4]$ ]]; then
    echo "Error: Slot must be 1-4" >&2
    exit 1
  fi
}

# Get disk path for a slot
get_nvme_disk_path() {
  local slot="$1"
  echo "$STATE_DIR/nvme-slot${slot}.qcow2"
}

# List all NVMe devices
nvme_list() {
  init_state
  echo "NVMe Devices:"
  echo "============="
  echo
  printf "%-6s %-12s %-10s %-10s\n" "Slot" "Status" "Connected" "Size"
  printf "%-6s %-12s %-10s %-10s\n" "----" "------" "---------" "----"

  for slot in 1 2 3 4; do
    local exists connected size status
    exists=$(get_nvme_state "$slot" "exists")
    connected=$(get_nvme_state "$slot" "connected")
    size=$(get_nvme_state "$slot" "size")

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

# Build QEMU NVMe arguments for connected devices
build_nvme_args() {
  local nvme_args=""

  for slot in 1 2 3 4; do
    local exists connected disk_path pci_slot serial
    exists=$(get_nvme_state "$slot" "exists")
    connected=$(get_nvme_state "$slot" "connected")

    if [[ "$exists" == "true" && "$connected" == "true" ]]; then
      disk_path=$(get_nvme_disk_path "$slot")
      pci_slot="${PCI_SLOT_MAP[$slot]}"
      serial=$(get_nvme_state "$slot" "serial")
      # Fallback for devices created before serial tracking
      if [[ -z "$serial" ]]; then
        serial="nvme${slot}"
      fi

      # Create PCIe root port with correct slot number, then attach NVMe
      nvme_args="$nvme_args -device pcie-root-port,id=rp${slot},slot=${pci_slot},chassis=${slot}"
      nvme_args="$nvme_args -drive file=${disk_path},format=qcow2,if=none,id=nvme${slot},cache=none,discard=unmap,aio=threads"
      nvme_args="$nvme_args -device nvme,drive=nvme${slot},serial=${serial},bus=rp${slot}"
    fi
  done

  echo "$nvme_args"
}

# Detect OVMF firmware paths
detect_ovmf() {
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
    echo "Error: OVMF firmware not found. On macOS: brew install qemu" >&2
    exit 1
  fi
}

# Boot the VM
boot_vm() {
  local image="$1"
  local memory="$2"
  local cores="$3"
  local disk_size="$4"
  local ssh_port="$5"
  local http_port="$6"

  init_state
  detect_ovmf

  if [[ ! -f "$image" ]]; then
    echo "Error: Image not found: $image" >&2
    exit 1
  fi

  command -v qemu-img >/dev/null 2>&1 || { echo "Error: 'qemu-img' not found in PATH" >&2; exit 1; }
  command -v qemu-system-x86_64 >/dev/null 2>&1 || { echo "Error: 'qemu-system-x86_64' not found in PATH" >&2; exit 1; }

  # Setup OVMF VARS
  local ovmf_vars="$STATE_DIR/ovmf-vars.fd"
  if [[ ! -f "$ovmf_vars" ]]; then
    cp "$OVMF_VARS_TEMPLATE" "$ovmf_vars"
  fi

  # Setup overlay disk
  local overlay="$STATE_DIR/overlay.qcow2"
  if [[ ! -f "$overlay" ]]; then
    echo "Creating overlay image..."
    local image_abs
    image_abs="$(cd "$(dirname "$image")" && pwd)/$(basename "$image")"
    qemu-img create -f qcow2 -F raw -b "$image_abs" "$overlay" "$disk_size" >/dev/null
  else
    echo "Using existing overlay image"
  fi

  # Build NVMe arguments
  local nvme_args
  nvme_args=$(build_nvme_args)

  # Platform-specific acceleration
  local accel_args
  local qemu_sudo=""
  case "$(uname -s)" in
    Linux)
      accel_args="-enable-kvm -machine accel=kvm,type=q35 -cpu host"
      # Use sudo for KVM access on Linux
      qemu_sudo="sudo"
      ;;
    Darwin)
      if qemu-system-x86_64 -accel help 2>&1 | grep -q hvf; then
        accel_args="-machine accel=hvf,type=q35 -cpu max"
      else
        echo "WARNING: HVF not available, using TCG (slow)" >&2
        accel_args="-machine accel=tcg,type=q35 -cpu max"
      fi
      ;;
    *)
      echo "Error: Unsupported platform: $(uname -s)" >&2
      exit 1
      ;;
  esac

  echo "Booting VM..."
  echo "  SSH: ssh -p ${ssh_port} umbrel@localhost"
  echo "  HTTP: http://localhost:${http_port}"
  echo

  # shellcheck disable=SC2086
  exec $qemu_sudo qemu-system-x86_64 \
    $accel_args \
    -smp "$cores" \
    -m "$memory" \
    -rtc base=utc \
    -nographic -monitor none -chardev stdio,id=char0,signal=off -serial chardev:char0 \
    -smbios "type=1,manufacturer=Umbrel,, Inc.,product=Umbrel Pro,sku=U4XN1,family=NAS" \
    -drive if=pflash,format=raw,readonly=on,file="$OVMF_CODE" \
    -drive if=pflash,format=raw,file="$ovmf_vars" \
    -drive file="$overlay",if=none,id=boot,format=qcow2,cache=none,discard=unmap,aio=threads \
    -device virtio-blk-pci,drive=boot,bootindex=0 \
    -netdev user,id=net0,hostfwd=tcp:127.0.0.1:${ssh_port}-:22,hostfwd=tcp:127.0.0.1:${http_port}-:80 \
    -device virtio-net-pci,netdev=net0 \
    $nvme_args
}

# Reflash (delete overlay to simulate fresh OS install)
reflash() {
  local overlay="$STATE_DIR/overlay.qcow2"
  if [[ -f "$overlay" ]]; then
    echo "Removing boot disk overlay..."
    rm -f "$overlay"
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
      *)
        echo "Error: Unknown nvme subcommand: $subcommand" >&2
        echo "Usage: $0 nvme <list|add|destroy|connect|disconnect> [args]" >&2
        exit 1
        ;;
    esac
    exit 0
    ;;

  boot)
    if [[ $# -lt 1 ]]; then
      echo "Error: boot requires an image path" >&2
      exit 1
    fi

    image="$1"
    shift

    memory="$DEFAULT_MEMORY"
    cores="$DEFAULT_CORES"
    disk_size="$DEFAULT_DISK_SIZE"
    ssh_port="$DEFAULT_SSH_PORT"
    http_port="$DEFAULT_HTTP_PORT"

    while [[ $# -gt 0 ]]; do
      case "$1" in
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

    boot_vm "$image" "$memory" "$cores" "$disk_size" "$ssh_port" "$http_port"
    ;;

  *)
    echo "Error: Unknown command: $command" >&2
    show_help
    exit 1
    ;;
esac
