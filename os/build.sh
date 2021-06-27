# SCRIPT_DIR="$(readlink $(dirname "${BASH_SOURCE[0]}"))"
SCRIPT_DIR=$(realpath $(dirname "${BASH_SOURCE[0]}"))
docker run \
  --rm \
  --privileged \
  -v /dev:/dev \
  -v ${SCRIPT_DIR}:/build \
  mkaczanowski/packer-builder-arm build raspberrypi.json
