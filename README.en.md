# WeChat CIMBAR File Receiver

**[中文](README.md)**

A native WeChat mini program that does **cimbar decoding only**, targeting Android and iPhone. It uses the phone camera to read the animated code images played by a sender, and performs positioning, error correction, file reassembly and decompression entirely on-device. When decoding completes, the user is prompted for a file name and the file is saved into the mini program's private directory. Everything runs offline: no server, no cloud development, no upload endpoint, and files are never uploaded.

The decoding core is a real libcimbar build compiled to WASM and shipped in the package, with no runtime npm dependencies. Source and issue reports: [lejw0925/wechat-libcimbar](https://github.com/lejw0925/wechat-libcimbar). If this tool helps you, a **Star** is appreciated (the "More" page offers a copy-source-link entry; it never stars or uploads files on your behalf).

## Screenshots (measured on iPhone)

| Receiving | Receive complete | History | More settings |
| --- | --- | --- | --- |
| ![Receiving](docs/images/screenshot-receiving.png) | ![Receive complete](docs/images/screenshot-complete.png) | ![History](docs/images/screenshot-history.png) | ![More settings](docs/images/screenshot-more.png) |

Measured on iPhone: sender on cimbar.org, Mode B (standard), effective receive throughput 86.4 KiB/s, with a 3.4 MiB file fully received and saved multiple times.

## Use it in WeChat

The mini program is officially released — scan with WeChat to use it:

<img src="docs/images/miniprogram-code.png" width="165" alt="WeChat mini program code">

## Run it yourself

1. Import the repository root in WeChat DevTools (`project.config.json` already sets `miniprogramRoot`), and replace the `appid` with your own mini program AppID. Tourist mode works for browsing the UI; on-device preview, permissions and the privacy flow require a real AppID. Never commit an AppSecret or any credential.
2. Choose base library **3.7.0 or newer** and preview with the current stable WeChat. No "build npm" step and no WASM rebuild are needed.
3. In the mini program admin console, add a camera-related user privacy policy; the code requests privacy authorization and `scope.camera` when a receive starts.
4. On another device, open [cimbar.org](https://cimbar.org), pick a file and play the code images. The default is **B · Standard / Mode B**; to change modes, tap "More" in the top-left corner and slide to the same setting as the sender.
5. The mini program opens directly onto the scan page and requests camera authorization. Aim at the full code image (all four corner markers inside the frame, screen and lens as parallel as possible), wait for the file to be recovered, then confirm the file name and save.

For a first try, use a file of a few dozen KiB and a slow playback frame rate; if standard mode is hard to recognize on low-resolution camera frames, switch both ends to Mini or Micro.

## Features

- **Home is scanning**: the camera is prepared on launch, with a square viewfinder and live progress plus effective throughput (a ~3-second sliding window over deduplicated valid payload).
- **Five modes**: Standard, Mini, Micro, legacy 4-color, legacy 8-color; the last choice is remembered. Switching with existing progress asks first, and a decoded file waiting to be saved is never discarded.
- **Adaptive sampling**: starts at 8 fps and steps between 4 / 8 / 12 / 20 fps based on load, always with a single frame in flight and no frame queue. On iPhone, frames are fetched directly inside the Worker (only sizes and results cross threads); on Android and the compatibility path, frames are center-cropped to a square before dispatch (43.75% fewer cross-thread pixels at 720×1280).
- **Pause and resume**: backgrounding pauses and foregrounding resumes the current session; the first memory warning auto-pauses with progress kept and caps that session at 4 fps, and only repeated warnings end the session, with a clear message.
- **Receive history**: slide up from the bottom of the scan page; rename, preview, export and delete (after confirmation). Files are written in 256 KiB chunks and only count once fully on disk; duplicate names get automatic numbering, with file-name filtering and path-traversal protection.
- **Appearance**: system font, blue action color, light/dark following WeChat automatically; detailed UI conventions live in [docs/design.md](docs/design.md).
- **Diagnostics**: the More page can copy diagnostics for the current and previous receive (mode, frame sizes, sampling rate, timings, WASM heap, etc.). Only two local snapshots are kept; they contain no file content and are never uploaded automatically.

## Where files are saved

The persistent location is `wx.env.USER_DATA_PATH/cimbar-received/`, the mini program's private directory, readable across pages and restarts. Mobile WeChat has no general API for writing to arbitrary system directories, so the exits are:

| File / platform | Exit |
| --- | --- |
| Ordinary files on Android / iPhone | Saved locally in the mini program; can be actively "forwarded to a WeChat chat" |
| JPG / PNG images, MP4 videos | Additionally "save to phone album" (requires permission and a valid format) |
| Documents supported by WeChat | Previewed via `openDocument` |
| Existing files on PC | `saveFileToDisk` where supported |

Clearing the mini program's data or deleting a record deletes the corresponding local files — export anything important.

## How it works

Camera RGBA → centered square crop → locate / perspective correction → symbol and color decode → Reed–Solomon error correction → Wirehair dedup and reassembly → Zstandard decompression → chunked write to disk → user naming.

The decoding algorithm comes from [libcimbar](https://github.com/sz3/libcimbar), and the camera receive flow references [CFC](https://github.com/sz3/cfc). The WASM runs in a Worker via `WXWebAssembly.instantiate`, without DOM, `fetch`, `TextDecoder` or browser timing APIs, and without SIMD or shared memory. One file is received at a time; the limits are 16 MiB compressed input, 64 MiB decompressed output and 256 MiB WASM memory — these are boundaries for rejecting oversized input, not a promise that a phone can receive files of that size. The protocol itself provides no sender authentication and no end-to-end file signature.

## Camera and speed accounting

WeChat only offers `small / medium / large` desired frame sizes; the actual pixels are decided by the system. A 720×1280 callback is decoded as its center 720×720, and 1080×1920 as 1080×1080 — pixels are never upscaled to fake a higher resolution (raw and decode sizes are visible in diagnostics). "Effective receive throughput" counts deduplicated valid fountain payload, excluding camera pixels, duplicate packets and error-correction overhead; it is not Wi-Fi speed, and not the file size divided by elapsed time. The performance investigation, benchmarks and comparison methodology against the Android CFC app live in [docs/performance.md](docs/performance.md).

## Rebuild from source

Verified build environment: Node.js 22, CMake 4, Emscripten 6.0.9, macOS arm64. Node.js 22.15 minimum (the full test suite uses Node's Zstd API). Rebuilding also needs Git, C/C++ build tools, and network access for the first dependency download.

```sh
npm run build:wasm
npm run check
npm test
npm run test:wasm
npm run test:memory
```

`build:wasm` automatically fetches and verifies the following pinned versions, builds OpenCV core/imgproc and the decode dependencies, and produces the JS loader, Brotli WASM, build hash and licenses. A mismatched existing checkout stops the build; your source is never overwritten.

- libcimbar: `bfb0c8e471820ae493cd3694ea6bed5d5ac06c37`
- OpenCV 4.11.0: `31b0eeea0b44b370fd0712312df4214d4ae1b158`
- CFC reference: `e143ebd16154f3db17fbfdf8d0da71b1b50678a4`

The Emscripten cache lives in `.cache/emscripten/`, and build outputs in `build/`. Use `CIMBAR_JOBS=4` to adjust parallelism. The test-only encoder stays in `build/decoder/` and **never enters the mini program package**.

To additionally run the official PNG sample regression, install FFmpeg and fetch the upstream samples:

```sh
git -C third_party/libcimbar submodule update --init samples
npm run test:wasm
```

## Verification status

Verified on desktop: real WASM load with the official Mode B sample restored (7,538 bytes); a synthetic 720×1280 camera frame built from the official sample fully recovered after cropping; all four upstream real-camera JPGs located and decoded; five-mode round trips over 60,000 bytes (frame loss, reordering, duplication) with SHA-256 matching the original; long 1 MiB hard-to-compress runs with the WASM heap stable at 32 MiB; 97 Node tests and 18 browser layout checks passing.

On real devices: iPhone has fully received 3.4 MiB files multiple times at 86.4 KiB/s effective throughput (naming, saving and history included — see the screenshots above), and Android receives files correctly at about 50 KB/s. Native HarmonyOS (HarmonyOS NEXT) has not been tested yet. The two-platform checklist lives in [docs/device-testing.md](docs/device-testing.md). The mini program is officially released on WeChat.

## License

This project's own source code is licensed under the [Mozilla Public License 2.0](LICENSE). Third-party components keep their own licenses and copyright notices; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the bundled license texts. The corresponding source of the compiled artifacts, pinned dependency versions and rebuild scripts are all available from this repository.
