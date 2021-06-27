docker run \
  --rm \
  --privileged \
  -v /dev:/dev \
  -v ${PWD}:/build \
  mkaczanowski/packer-builder-arm build raspberrypi.json
