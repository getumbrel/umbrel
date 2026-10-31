#!/usr/bin/env python3
"""Check the kernel manifest against authenticated, locally supplied Debian metadata."""

import argparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import lzma
from pathlib import Path
import re
import subprocess
import sys
import tempfile


ARCHITECTURES = ("amd64", "arm64")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fields(text):
    """Parse one Debian control paragraph, including continuation lines."""
    result = {}
    key = None
    for line in text.splitlines():
        if line.startswith((" ", "\t")):
            require(key is not None, "orphan control-field continuation")
            result[key] += "\n" + line[1:]
        else:
            key, separator, value = line.partition(":")
            require(separator and key not in result, "malformed or duplicate control field")
            result[key] = value.lstrip()
    return result


def docker_default(dockerfile, name):
    match = re.search(r"^ARG " + re.escape(name) + r"=([^\s]+)$", dockerfile, re.MULTILINE)
    require(match is not None, f"missing Dockerfile default: {name}")
    return match[1]


def verify(args):
    dockerfile = args.dockerfile.read_text()
    version = args.version or docker_default(dockerfile, "LINUX_VERSION")
    snapshot = args.snapshot or docker_default(dockerfile, "LINUX_SNAPSHOT_DATE")
    codename = args.codename or docker_default(dockerfile, "DEBIAN_VERSION") + "-security"
    snapshot_time = datetime.strptime(snapshot, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)

    # Only consume the verifier's authenticated output, never the raw clearsigned body.
    with tempfile.TemporaryDirectory(prefix="verify-linux-") as temporary:
        release_path = Path(temporary) / "Release"
        subprocess.run(
            ["sqv", "--keyring", str(args.keyring.resolve()), "--cleartext",
             str((args.metadata / "InRelease").resolve()), "--output", str(release_path)],
            check=True,
        )
        release = fields(release_path.read_text())
    require(release.get("Origin") == "Debian" and release.get("Label") == "Debian-Security",
            "not a Debian security release")
    require(release.get("Codename") == codename, "release codename mismatch")
    require(parsedate_to_datetime(release["Date"]) <= snapshot_time <=
            parsedate_to_datetime(release["Valid-Until"]),
            "snapshot time outside signed release validity window")
    checksums = {}
    for line in release["SHA256"].splitlines():
        if not line.strip():
            continue
        digest, size, filename = line.split()
        require(re.fullmatch(r"[0-9a-f]{64}", digest), "invalid release SHA256")
        require(filename not in checksums, "duplicate release SHA256 path")
        checksums[filename] = (digest, int(size))

    manifest = {}
    for line in args.manifest.read_text().splitlines():
        digest, filename = line.split()
        require(re.fullmatch(r"[0-9a-f]{64}", digest), "invalid manifest SHA256")
        require(re.fullmatch(r"pool/updates/main/[^\s]+\.deb", filename) and
                ".." not in Path(filename).parts, "invalid manifest package path")
        require(filename not in manifest, "duplicate manifest package path")
        manifest[filename] = digest
    require(manifest, "empty manifest")

    matched = set()
    for arch in ARCHITECTURES:
        index_path = f"main/binary-{arch}/Packages.xz"
        compressed = (args.metadata / index_path).read_bytes()
        require(checksums.get(index_path) ==
                (hashlib.sha256(compressed).hexdigest(), len(compressed)),
                f"{arch}: index SHA256/size mismatch")
        seen = set()
        for paragraph in lzma.decompress(compressed).decode().strip().split("\n\n"):
            package = fields(paragraph)
            filename = package.get("Filename", "")
            if filename not in manifest:
                continue
            require(filename not in seen, f"{arch}: duplicate package entry: {filename}")
            require(package.get("SHA256") == manifest[filename],
                    f"{arch}: package SHA256 mismatch: {filename}")
            require(package.get("Version") == version,
                    f"{arch}: package version mismatch: {filename}")
            package_arch = package.get("Architecture")
            require(package_arch in (arch, "all") and filename.endswith(f"_{package_arch}.deb"),
                    f"{arch}: package architecture mismatch: {filename}")
            seen.add(filename)
        # Each architecture must independently authenticate its shared 'all' packages too.
        expected = {name for name in manifest if name.endswith((f"_{arch}.deb", "_all.deb"))}
        require(expected and any(name.endswith(f"_{arch}.deb") for name in expected),
                f"{arch}: no architecture-specific manifest packages")
        require(seen == expected, f"{arch}: missing manifest packages: {sorted(expected - seen)}")
        matched.update(seen)
        print(f"PASS: {arch}: authenticated index; {len(seen)} manifest packages match")
    require(matched == set(manifest), "manifest contains packages outside amd64/arm64/all indices")
    print(f"PASS: all {len(manifest)} manifest SHA256 values; version {version}; snapshot {snapshot}")


def main():
    package_dir = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("metadata", type=Path, help="directory containing InRelease and main/binary-ARCH/Packages.xz")
    parser.add_argument("--keyring", type=Path, required=True, help="trusted Debian archive keyring (not downloaded alongside metadata)")
    parser.add_argument("--manifest", type=Path, default=package_dir / "linux-packages.sha256")
    parser.add_argument("--dockerfile", type=Path, default=package_dir / "umbrelos.Dockerfile")
    parser.add_argument("--version", help="override Dockerfile LINUX_VERSION")
    parser.add_argument("--snapshot", help="override Dockerfile LINUX_SNAPSHOT_DATE (YYYYMMDDTHHMMSSZ)")
    parser.add_argument("--codename", help="override Dockerfile DEBIAN_VERSION + '-security'")
    args = parser.parse_args()
    try:
        verify(args)
    except (OSError, ValueError, KeyError, lzma.LZMAError, subprocess.CalledProcessError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
