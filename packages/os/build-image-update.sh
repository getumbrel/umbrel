#!/bin/bash

# build only for AMD64 and create a new .update image
SKIP_ARM64=1 SKIP_PI4=1 SKIP_PI5=1 ./build.sh
