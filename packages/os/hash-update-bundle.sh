#!/usr/bin/env bash
set -euo pipefail

# Print an update bundle's Rugix bundle hash, which the release manifest pins:
#
#   ./hash-update-bundle.sh build/umbrelos-amd64.update
#
# It refuses a bundle that doesn't install a system, like one with only a script. Rugix still points the
# next boot at the inactive system after installing one with `--reboot set`, which is how devices install
# updates, so the device would reboot into whatever old system was there. It also refuses a bundle with
# a script payload, which Rugix pipes into bash as it streams in, before it checks the payload's hash, so
# a changed script would run. A release's update script is the way to run code before an update.

cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

if [[ "$#" -ne 1 ]]; then
    echo "Usage: $0 <update bundle>" >&2
    exit 1
fi
bundle="$(readlink -f "$1")"

rugix_bakery_image="$(sed -n 's/^export RUGIX_BAKERY_IMAGE="\([^"]*\)".*/\1/p' build.sh)"
bundler() {
    docker run --rm --entrypoint rugix-bundler --volume "$(dirname "${bundle}"):/bundle:ro" \
        "${rugix_bakery_image}" "$@" "/bundle/$(basename "${bundle}")"
}

payloads="$(bundler inspect)"
if ! grep --quiet '^  [0-9]*: slot="system"' <<< "${payloads}"; then
    echo "$(basename "${bundle}") doesn't install a system, so devices can't be given it as an update" >&2
    exit 1
fi
if grep --quiet '^  [0-9]*: execute(' <<< "${payloads}"; then
    echo "$(basename "${bundle}") has a script payload, which runs before Rugix checks it, so use an update script" >&2
    exit 1
fi
bundler hash
