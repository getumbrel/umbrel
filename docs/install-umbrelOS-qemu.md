# Guide: UmbrelOS Deployment with QEMU/KVM

This documentation provides a robust, workflow for deploying UmbrelOS in virtualized, headless environments. It ensures high availability via `systemd` and solves the persistent UEFI variable issue common in cloud-based QEMU configurations.

## Table of Contents

1. Prerequisites
2. Phase 1: Environment Setup
3. Phase 2: Virtual Asset Creation
4. Phase 3: Manual Installation (VNC)
5. Phase 4: Production Deployment & Access
6. Phase 5: Port Management & App Expansion
7. Verification & Maintenance
---

## Prerequisites

* **Local Machine:** A VNC Viewer (e.g., **[TigerVNC](https://github.com/TigerVNC/tigervnc/releases)**).
* **Host:** A host with Ubuntu/Debian and `sudo` access.
* **Resources:** User-defined RAM (min 2G) and Disk space.

---

## Phase 1: Environment Setup

Prepare the host with virtualization tools and fetch the latest UmbrelOS image.

```bash
# Install QEMU and UEFI support
sudo apt update && sudo apt install -y qemu-system-x86 qemu-utils ovmf wget

# Download the official UmbrelOS installer
sudo wget https://download.umbrel.com/release/latest/umbrelos-amd64-usb-installer.iso

```

---

## Phase 2: Virtual Asset Creation

Create the virtual storage and the UEFI persistence file. This ensures the VM remembers its boot order after the installer is removed.

```bash
# Create the virtual disk (Replace [SIZE] with e.g., 80G)
qemu-img create -f qcow2 umbrel-cloud.qcow2 [SIZE]

# Create persistent UEFI variables
cp /usr/share/OVMF/OVMF_VARS_4M.fd /root/umbrel_vars.fd

```

---

## Phase 3: Manual Installation (VNC)

The `bootindex` flags are critical; they force the system to boot from the installer first.

```bash
qemu-system-x86_64 -m [RAM] -enable-kvm -cpu host \
  -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd \
  -drive if=pflash,format=raw,file=/root/umbrel_vars.fd \
  -drive file=umbrel-cloud.qcow2,format=qcow2,if=none,id=drive0 \
  -device virtio-blk-pci,drive=drive0,bootindex=2 \
  -usb -device usb-storage,drive=installer,bootindex=1 \
  -drive file=umbrelos-amd64-usb-installer.iso,format=raw,if=none,id=installer \
  -netdev user,id=net0 -device virtio-net-pci,netdev=net0 \
  -vga std -vnc 0.0.0.0:0

```

1. **Firewall:** `sudo ufw allow 5900/tcp`
2. **Action:** Connect your VNC client to `[YOUR_VPS_IP]:5900`.
<img width="449" height="172" alt="image" src="https://github.com/user-attachments/assets/2c095bd5-afd3-408d-96df-ccd158c1423e" />
<img width="803" height="308" alt="image" src="https://github.com/user-attachments/assets/3571f1da-d949-437c-ab60-4a76e5a28f38" />

4. **Finish:** Complete the Umbrel installation UI. Once the VM attempts to reboot, press **Ctrl+C** in your terminal.
<img width="802" height="437" alt="image" src="https://github.com/user-attachments/assets/01dd22e6-75fe-4175-bb4e-d37edb83270f" />

---

## Phase 4: Production Deployment & Access

To ensure the VM survives host reboots, use a `systemd` service.

**Create file:** `sudo nano /etc/systemd/system/umbrel.service`

```ini
[Unit]
Description=UmbrelOS Virtual Machine
After=network.target

[Service]
Type=simple
WorkingDirectory=/root
ExecStartPre=-/usr/bin/pkill qemu
ExecStart=/usr/bin/qemu-system-x86_64 \
  -m [RAM] -enable-kvm -cpu host \
  -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd \
  -drive if=pflash,format=raw,file=/root/umbrel_vars.fd \
  -drive file=/root/umbrel-cloud.qcow2,format=qcow2,if=none,id=drive0 \
  -device virtio-blk-pci,drive=drive0,bootindex=0 \
  -netdev user,id=net0,hostfwd=tcp::8080-:80,hostfwd=tcp::6420-:6420,hostfwd=tcp::4848-:4848,hostfwd=tcp::3001-:3001,hostfwd=tcp::2100-:2100,hostfwd=tcp::59000-:59000 \
  -device virtio-net-pci,netdev=net0 \
  -vga std -display none -vnc 0.0.0.0:0 \
  -audiodev none,id=snd0
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target

```

**Activation:**

```bash
sudo ufw allow 8080/tcp
sudo ufw delete allow 5900/tcp
sudo systemctl daemon-reload
sudo systemctl enable --now umbrel

```

### **Accessing Your Dashboard**

Once the service is started, Umbrel is accessible via your web browser:
<img width="1170" height="621" alt="image" src="https://github.com/user-attachments/assets/d988ce86-2563-4cd2-ae49-e17ef7abb5e7" />

* **URL:** `http://[YOUR_VPS_IP]:8080`

---

## Phase 5: Port Management & App Expansion

When you install a new app (e.g., port `5000`):

1. **Edit Service:** `sudo nano /etc/systemd/system/umbrel.service`
2. **Add Mapping:** Append `,hostfwd=tcp::5000-:5000` to the `-netdev user` line.
3. **Firewall:** `sudo ufw allow 5000/tcp && sudo ufw reload`
4. **Restart:** `sudo systemctl daemon-reload && sudo systemctl restart umbrel`

---

## Verification & Maintenance

* **Check Status:** `sudo systemctl status umbrel`
* **Monitor Logs:** `sudo journalctl -u umbrel -f`
* **Verify Ports:** `sudo ss -tulpn | grep qemu`

---
