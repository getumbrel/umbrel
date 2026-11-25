# NixOS configuration for the umbrelOS USB installer.
#
# Builds a minimal live ISO that boots an immutable squashfs root (with a
# tmpfs overlay for runtime state) and runs the installer script on tty1.
# The umbrelOS image is not part of this configuration, it's grafted into
# the final ISO afterwards and read from the boot medium at
# /iso/umbrelos-amd64.img.xz.
{
  config,
  lib,
  pkgs,
  modulesPath,
  ...
}: let
  # Plain bootloader background instead of the NixOS artwork. Both bootloader
  # menu themes render black text over the splash so it needs to be light.
  plainSplash = pkgs.runCommand "plain-splash.png" {nativeBuildInputs = [pkgs.netpbm];} ''
    ppmmake rgb:ff/ff/ff 800 600 | pnmtopng > $out
  '';

  # The installer only needs storage, USB and console support, so drop large
  # kernel module categories that can never be needed to flash an image.
  # Modules ship pre-compressed (.ko.xz) so squashfs can't shrink them and
  # they'd otherwise dominate the ISO size.
  prunedKernelModules = pkgs.runCommand "${config.boot.kernelPackages.kernel.name}-modules-pruned" {} ''
    mkdir -p $out/lib/modules
    cp -r ${config.boot.kernelPackages.kernel.modules}/lib/modules/. $out/lib/modules/
    chmod -R u+w $out/lib/modules
    version="$(ls $out/lib/modules)"
    rm -rf \
      "$out/lib/modules/$version/kernel/drivers/gpu" \
      "$out/lib/modules/$version/kernel/drivers/iio" \
      "$out/lib/modules/$version/kernel/drivers/infiniband" \
      "$out/lib/modules/$version/kernel/drivers/media" \
      "$out/lib/modules/$version/kernel/drivers/net" \
      "$out/lib/modules/$version/kernel/net" \
      "$out/lib/modules/$version/kernel/sound"
  '';
in {
  imports = [
    (modulesPath + "/installer/cd-dvd/iso-image.nix")
    (modulesPath + "/profiles/minimal.nix")
  ];

  options.umbrel.altGraphics = lib.mkOption {
    type = lib.types.bool;
    default = false;
    description = "Boot with kernel modesetting instead of the safe nomodeset default.";
  };

  config = {
    nixpkgs.hostPlatform = "x86_64-linux";
    system.stateVersion = "26.05";

    # Render boot menu entries as "umbrelOS installer".
    system.nixos.distroName = "umbrelOS";
    system.nixos.label = "installer";

    # Don't let systemd warn about the NixOS release reaching end-of-support,
    # it's meaningless for an ephemeral offline installer.
    system.nixos.extraOSReleaseArgs.SUPPORT_END = "";

    isoImage = {
      volumeID = "UMBRELINSTALLER";
      makeBiosBootable = true;
      makeEfiBootable = true;
      makeUsbBootable = true;
      appendToMenuLabel = "";
      grubTheme = null;
      splashImage = plainSplash;
      efiSplashImage = plainSplash;
      squashfsCompression = "xz -Xdict-size 100%";
      # Use the text mode GRUB menu on EFI. The graphical menu needs a video
      # mode switch that can crash QEMU when it's run headless (VM tests) and
      # is a compatibility risk on devices with quirky graphics.
      forceTextMode = true;
    };
    image.baseName = lib.mkForce "umbrelos-amd64-usb-installer";

    system.modulesTree = lib.mkForce [prunedKernelModules];

    boot.loader.timeout = lib.mkForce 5;

    # Keep the boot quiet — the installer has its own UI, so we don't want
    # kernel/systemd console spam (e.g. harmless firmware ACPI table warnings)
    # flashing by. consoleLogLevel is the option that controls the kernel
    # `loglevel=` param; setting it here (rather than adding loglevel to
    # kernelParams) avoids it being overridden by the NixOS default of 4. 3
    # still lets genuine crit/alert/emerg messages through.
    boot.consoleLogLevel = 3;

    # Default to nomodeset because some devices have graphical issues without
    # it: https://github.com/getumbrel/umbrel/issues/2013
    boot.kernelParams =
      ["quiet"]
      ++ lib.optionals (!config.umbrel.altGraphics) ["nomodeset" "vga=normal" "fbcon=font:VGA8x16"];

    # Second boot menu entry ("umbrelOS installer (alt graphics)") with kernel
    # modesetting enabled for devices where the nomodeset console doesn't work.
    specialisation.alt-graphics.configuration = {
      umbrel.altGraphics = true;
      isoImage.configurationName = "(alt graphics)";
    };

    # The live system never needs Nix itself. Replace the standard live CD
    # store registration so the Nix package isn't pulled into the image.
    nix.enable = false;
    system.disableInstallerTools = true;
    system.switch.enable = false;
    systemd.services.register-nix-paths.enable = false;
    boot.postBootCommands = lib.mkForce ''
      touch /etc/NIXOS
    '';

    # grub2_efi is only needed at build time to create the EFI boot image,
    # don't include it in the live system as well.
    system.extraDependencies = lib.mkForce [];

    # Don't include systemd-importd (which pulls in gnupg), container image
    # imports are useless on an installer.
    systemd.suppressedSystemUnits = ["systemd-importd.service"];

    # The installer is fully offline.
    networking.useDHCP = false;
    networking.firewall.enable = false;

    services.lvm.enable = false;

    # Run the installer UI on tty1 instead of a login prompt.
    systemd.services.custom-tty = {
      description = "Custom TTY";
      after = ["multi-user.target"];
      wantedBy = ["multi-user.target"];
      path = with pkgs; [
        bash
        coreutils
        dmidecode
        dosfstools
        gawk
        gnugrep
        gnused
        mtools
        ncurses
        systemd
        util-linux
        xz
      ];
      serviceConfig = {
        ExecStart = pkgs.writeScript "custom-tty" (builtins.readFile ./custom-tty);
        StandardInput = "tty";
        StandardOutput = "tty";
        StandardError = "tty";
        TTYPath = "/dev/tty1";
        Restart = "on-failure";
      };
    };
    systemd.services."getty@tty1".enable = false;
    systemd.services."autovt@tty1".enable = false;

    # Root login on tty2+ for debugging.
    users.users.root.initialPassword = "root";

    environment.systemPackages = with pkgs; [dmidecode xz];
  };
}
