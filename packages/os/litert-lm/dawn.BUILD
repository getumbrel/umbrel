# Dawn, built with CMake before LiteRT-LM (see the LiteRT-LM build stage in
# umbrelos.Dockerfile): its headers and its library. LiteRT's own Dawn BUILD
# file only has the headers.
package(default_visibility = ["//visibility:public"])

cc_import(
    name = "webgpu_dawn_so",
    shared_library = "lib/libwebgpu_dawn.so",
)

cc_library(
    name = "webgpu_headers",
    hdrs = glob(["include/**/*.h"]),
    includes = ["include"],
)

cc_library(name = "dawn_headers", deps = [":webgpu_headers"])
cc_library(name = "dawncpp_headers", deps = [":webgpu_headers"])
cc_library(name = "dawn_native", deps = [":webgpu_headers"])
cc_library(name = "libdawn_proc", deps = [":webgpu_headers"])

cc_library(
    name = "webgpu_dawn",
    deps = [":webgpu_headers", ":webgpu_dawn_so"],
)
