{
  description = "umbrelOS USB installer";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = {
    self,
    nixpkgs,
  }: let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
  in {
    nixosConfigurations.usb-installer = nixpkgs.lib.nixosSystem {
      modules = [./configuration.nix];
    };

    packages.${system} = {
      # The installer ISO without an umbrelOS image. The image is injected
      # afterwards with `inject-umbrelos-image` so this (slow) build can run
      # concurrently with the umbrelOS image build.
      iso = self.nixosConfigurations.usb-installer.config.system.build.isoImage;
      default = self.packages.${system}.iso;

      # Produces the final installer ISO from the (image-less) base ISO and an
      # umbrelOS image.
      #
      # It re-masters rather than just grafting the image in, because NixOS's
      # iso-image builds the hybrid ISO with xorriso's -isohybrid-gpt-basdat:
      # the EFI partition lives *inside* the ISO9660 area and overlaps the main
      # partition. QEMU's OVMF and MBR-reading firmware boot this fine, but
      # GPT-preferring UEFI firmware (e.g. the Umbrel Pro) ignores a USB disk
      # without a real, standalone EFI System Partition and falls through to
      # internal storage.
      #
      # So we extract the NixOS ISO contents, add the umbrelOS image, and
      # rebuild with the standard distro layout: syslinux El Torito + isohybrid
      # MBR for BIOS, and the EFI image as a proper appended GPT EFI System
      # Partition for UEFI (CD and USB).
      inject-umbrelos-image = pkgs.writeShellApplication {
        name = "inject-umbrelos-image";
        runtimeInputs = [pkgs.xorriso pkgs.syslinux];
        text = ''
          base_iso="$1"
          umbrelos_image="$2"
          output_iso="$3"

          workdir="$(mktemp -d)"
          trap 'rm -rf "$workdir"' EXIT
          tree="$workdir/iso"

          # -return_with tolerates SORRY severity problems (e.g. xattr ioctls
          # unsupported on macOS Docker bind mounts) while real problems remain
          # FAILURE severity and still abort.
          xorriso -return_with FAILURE 32 -osirrox on -acl off -xattr off \
            -indev "$base_iso" -extract / "$tree"

          chmod -R u+w "$tree"

          # Add the umbrelOS image the installer flashes.
          cp "$umbrelos_image" "$tree/umbrelos-amd64.img.xz"

          # Pull the EFI FAT image out of the tree to append as a real ESP, and
          # drop the stale El Torito catalog so xorriso writes a fresh one.
          mv "$tree/boot/efi.img" "$workdir/efi.img"
          rm -f "$tree/.boot.cat" "$tree/boot.cat"

          # Extracting gives the files the current time, which xorriso would
          # record, so date them by SOURCE_DATE_EPOCH instead. xorriso takes
          # the ISO's own dates and IDs from SOURCE_DATE_EPOCH too.
          find "$tree" "$workdir/efi.img" -exec touch -h -d "@''${SOURCE_DATE_EPOCH}" {} +

          # Mirror NixOS's make-iso9660-image options, but expose the EFI image
          # as an appended GPT EFI System Partition instead of an overlapping
          # basic-data partition.
          xorriso -return_with FAILURE 32 -as mkisofs \
            -iso-level 3 \
            -volid UMBRELINSTALLER \
            -appid nixos \
            -publisher nixos \
            -full-iso9660-filenames \
            -joliet \
            -rational-rock \
            -isohybrid-mbr "${pkgs.syslinux}/share/syslinux/isohdpfx.bin" \
            -eltorito-catalog .boot.cat \
            -eltorito-boot isolinux/isolinux.bin \
            -no-emul-boot -boot-load-size 4 -boot-info-table \
            --sort-weight 1 /isolinux \
            -eltorito-alt-boot \
            -e --interval:appended_partition_2:all:: \
            -no-emul-boot \
            -append_partition 2 c12a7328-f81f-11d2-ba4b-00a0c93ec93b "$workdir/efi.img" \
            -appended_part_as_gpt \
            -o "$output_iso" \
            "$tree"
        '';
      };
    };
  };
}
