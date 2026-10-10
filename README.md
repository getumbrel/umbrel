[![umbrelOS](https://github.com/user-attachments/assets/0d7874d9-36a6-4405-81cd-789b72d7dea0)](https://umbrel.com/umbrelos)

<p align="center">
  <h1 align="center">umbrelOS</h1>
  <p align="center">
    A beautiful home server OS for self-hosting
    <br />
    <a href="https://umbrel.com"><strong>umbrel.com »</strong></a>
    <br />
    <br />
       Get an <a href="https://umbrel.com/umbrel-pro">Umbrel Pro</a> or <a href="https://umbrel.com/umbrel-home">Umbrel Home</a>, or <a href="https://umbrel.com/downloads">download umbrelOS</a> for free on an Intel or AMD machine, Raspberry Pi 5, or a virtual machine.
    <br />
    <br />
    <a href="https://x.com/umbrel">
      <img src="https://img.shields.io/twitter/follow/umbrel?style=social" />
    </a>
    <a href="https://discord.gg/efNtFzqtdx">
      <img src="https://img.shields.io/discord/936694604231766046?logo=discord&logoColor=5351FB&label=Discord&labelColor=white&color=5351FB&cacheSeconds=60">
    </a>
    <a href="https://reddit.com/r/getumbrel">
      <img src="https://img.shields.io/reddit/subreddit-subscribers/getumbrel?style=social">
    </a>
    <a href="https://community.umbrel.com">
      <img src="https://img.shields.io/discourse/users?server=https%3A%2F%2Fcommunity.umbrel.com&style=flat&label=Community%20Forum&color=5351FB&cacheSeconds=60">
    </a>
  </p>
</p>

<br />

<p align="center">
At Umbrel, we believe that everyone should be able to enjoy the convenience and benefits of the cloud, without giving up ownership and control of their data.
</p>

<p align="center">
To achieve our vision, we're building a new kind of a home server OS. Just like the cloud, but one that you own and control.
</p>

<br />

<p align="center">
  <h1 align="center">umbrelOS 2.0</h1>
  <img width="3840" height="2880" alt="bento 2 0" src="https://github.com/user-attachments/assets/a183106e-7d8a-4b84-bd7b-4cd06c9ff148" />
</p>

umbrelOS 2.0 is currently in beta, with the stable release planned for **September 22, 2026**. Try it out today:

- **Fresh install:** download the 2.0 beta from [umbrel.com/downloads](https://umbrel.com/downloads).
- **Already on umbrelOS:** update to umbrelOS 1.7.4 or later, then go to **Settings > Advanced settings** and turn on **umbrelOS beta program** to receive the 2.0 beta.


## Installing umbrelOS

umbrelOS is free and complete on any hardware. The image you install on your own device is the same umbrelOS that ships on [Umbrel Home](https://umbrel.com/umbrel-home) and [Umbrel Pro](https://umbrel.com/umbrel-pro), with the same features and the same updates.

### Supported devices

- **Intel and AMD devices:** umbrelOS supports most 64-bit mini PCs, laptops, desktops, NAS boxes, and servers. Minimum requirements: Dual-core CPU, 4 GB RAM (8 GB+ recommended), and a 32 GB drive for umbrelOS. umbrelOS boots from one drive and uses the rest for apps and data.
- **Raspberry Pi 5:** boot from an NVMe or USB drive rather than a microSD card.
- **Virtual machines:** Proxmox, VirtualBox, VMware, or anything else that supports EFI boot.

A few features depend on your hardware. Storage Manager and FailSafe need two or more internal NVMe or SATA drives, and GPU acceleration needs an NVIDIA, AMD, or Intel GPU on an Intel or AMD machine. Classic Linux RAID arrays (see below) need two or more internal drives per array.

## Linux RAID (mdadm)

This fork adds classic Linux software RAID alongside ZFS. You can create RAID `0`, `1`, `5`, `6` and `10` arrays from internal drives in **Settings > Storage Manager**, format them as **ext4**, **btrfs**, **xfs**, **exFAT**, **FAT32** or **NTFS**, and browse them in Files under **/Raid**.

- **Boot safety:** arrays are assembled before `umbreld` starts and remounted from `/etc/fstab` at every boot. Entries are keyed by filesystem UUID (so they survive `/dev/mdN` renumbering) and carry `nofail`, meaning a missing or degraded array never blocks boot. You can unmount an array from Files at any time, which also drops its fstab entry.
- **Choosing a filesystem:** `ext4`, `btrfs` and `xfs` store real Linux ownership and permissions, so they are the right choice for anything that apps or Samba shares need to write. `exFAT`, `FAT32` and `NTFS` cannot store Linux ownership — use them for general files only, not for app data. Umbrel flags these as *no ownership* in the UI.
- **Growing an array:** add a disk to a RAID 5/6 array to expand it online (the reshape progress is shown in Storage Manager). After replacing members with larger disks, use **Use max size** to reclaim the extra capacity.

<details>
<summary><strong>Services and files</strong></summary>

| Component | Purpose |
| --- | --- |
| `umbrel-mdadm-assemble.service` | `mdadm --assemble --scan --run` before umbreld; refreshes `/etc/mdadm/mdadm.conf` |
| `umbrel-mdadm-mount.service` | `mount -a` from `/etc/fstab` and starts an `mdadm --monitor` daemon |
| `/etc/fstab` | One entry per mounted array, keyed by filesystem UUID, with `nofail` |
| `/run/mdadm/mdN` | Kernel-level mountpoint of each array (tmpfs, recreated at boot) |
| `/Raid` | Files virtual root exposing every mounted array |

</details>

### Download and install

Head to **[umbrel.com/downloads](https://umbrel.com/downloads)** for the latest umbrelOS ISO and images, along with step-by-step installation guides for each platform.

> [!NOTE]
> umbrelOS is a standalone operating system that installs directly onto your device. It can't be installed on top of an existing Linux distribution.

## Building apps for umbrelOS

If you're interested in building an app for umbrelOS or packaging an existing one, please refer to the [Umbrel App Framework documentation](https://github.com/getumbrel/umbrel-apps/blob/master/README.md).

## License

umbrelOS is licensed under the PolyForm Noncommercial 1.0.0 license. TL;DR — You're free to use, fork, modify, and redistribute Umbrel for personal and nonprofit use under the same license. If you're interested in using umbrelOS for commercial purposes, such as selling plug-and-play home servers with umbrelOS, etc — please reach out to us at partner@umbrel.com.

[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-%235351FB)](https://github.com/getumbrel/umbrel/blob/master/LICENSE.md)

[umbrel.com](https://umbrel.com)
