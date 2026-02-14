{
  "targets": [
    {
      "target_name": "ax_native",
      "sources": [ "native/ax_extractor.mm" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "OTHER_CPLUSPLUSFLAGS": ["-std=c++17", "-stdlib=libc++", "-fobjc-arc"],
            "OTHER_LDFLAGS": ["-framework ApplicationServices", "-framework Cocoa", "-framework AppKit"],
            "MACOSX_DEPLOYMENT_TARGET": "10.15"
          }
        }]
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ]
    }
  ]
}
