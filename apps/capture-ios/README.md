# Fullscale capture for iPhone

Scans rooms with the iPhone's camera and, on LiDAR phones, Apple's room scanner (RoomPlan), LiDAR depth and the 3D mesh, all in one AR session. It adds tape-measure checks and writes everything as a `fullscale-capture/1` folder (see [docs/capture-format.md](../../docs/capture-format.md)) for the studio to import.

| Folder | What | Built and tested here? |
|---|---|---|
| `CaptureKit/` | The capture format, the rules for which frames and photos to keep, tape checks, depth and mesh encoding, and the crash-safe bundle writer. No camera code. | **Yes**: `swift test` on a Mac |
| `App/` | The iPhone app: ARKit, RoomPlan and the screens. Thin: every decision goes through CaptureKit. | **Builds** (Xcode, Swift 6, no warnings); not yet run on a phone |

## Devices

- **Tier 1, LiDAR iPhones and iPads** (Pro models): room layouts, LiDAR depth, the mesh and photos. Expected accuracy about ±1–2 cm (an estimate until tape checks on real phones measure it).
- **Tier 2, other iPhones with ARKit**: AR tracking and photos only; the computer adds dense geometry, and tape checks set the scale. Lower accuracy, shown honestly as larger ± values.

Android gets its own app (Kotlin, ARCore) writing the same format; it is not built yet.

## CaptureKit tests

```sh
cd apps/capture-ios/CaptureKit && swift test
```

Needs Swift 6 (the Xcode Command Line Tools are enough). The tests use Swift Testing. Tape-length reading and the green/amber/red grading are tested against the shared cases in `fixtures/tape-checks.json`, the same cases the studio is tested against, so the phone and the computer read "11' 2\"" alike.

## Building the app

Needs Xcode 16 or newer. The app runs in the simulator, but scanning needs a real iPhone or iPad: the simulator has no camera or LiDAR.

```sh
brew install xcodegen
cd apps/capture-ios/App && xcodegen
open FullscaleCapture.xcodeproj
```

The Xcode project is generated from `project.yml` and not kept in git. Change `project.yml`, not the project.

### Running it on your iPhone

1. **Xcode → Settings → Accounts**: add your Apple ID. A free account works; apps it installs stop opening after 7 days, until you run them from Xcode again.
2. Select the **FullscaleCapture** target → **Signing & Capabilities** → choose your team (your name, "Personal Team"). If Xcode says the bundle identifier is taken, change it to something of your own, e.g. `org.fullscale.capture.yourname`. Running `xcodegen` again resets both, so set them again after it.
3. Connect the phone with a cable and unlock it. On the phone: **Settings → Privacy & Security → Developer Mode** → on, then restart it when asked.
4. Pick the phone at the top of the Xcode window and press **Run** (⌘R).
5. The first time, the phone refuses to open the app: **Settings → General → VPN & Device Management** → your Apple ID → **Trust**.

If the phone says it can't verify the app, it needs the internet once to check with Apple: turn off any VPN, Private Relay or ad blocker, or restart the phone, and tap **Verify App** again.

Captures appear in the app and in the Files app (On My iPhone → Fullscale → Captures). Share one as a zip (AirDrop to the Mac), unzip it inside your home's folder, and import it with the `import_capture` agent tool.

From the command line, with the phone connected and its team chosen once in Xcode (`xcrun devicectl list devices` gives the phone's id). Real captures go in `data/captures-in/`, which git ignores:

```sh
xcodebuild -project FullscaleCapture.xcodeproj -scheme FullscaleCapture -destination 'id=<phone id>' \
  -derivedDataPath /tmp/fullscale-dd -allowProvisioningUpdates build
xcrun devicectl device install app --device <phone id> /tmp/fullscale-dd/Build/Products/Debug-iphoneos/FullscaleCapture.app
xcrun devicectl device copy from --device <phone id> --domain-type appDataContainer --domain-identifier org.fullscale.capture \
  --source Documents/Captures/<capture id> --destination ../../../data/captures-in/<capture id>
```

### A first real scan

Pick a simple room. Scan it slowly along the walls, then the floor and ceiling. Take a grey-card photo if you have a card. After **Finish**, measure two or three walls and a door with a tape and type them in. The app shows how each compares with the scan (green within 1% and 2 cm). Those numbers are the first real measure of the app's accuracy, so please keep them.

## Not verified yet

The app runs on an iPhone 18 Pro (iOS 27.0.1). Two one-room scans so far:
- Tracking, the white-balance lock, photos and depth keyframes work.
- The first scan lost its room layout and mesh: one failed save took the others with it. Each part is now saved on its own, and the second scan kept its layout (4 walls, a door, a window, the floor, 4 objects) and its mesh (114,000 points).
- The scanner's raw data (`roomplan-data.json`, a backup) doesn't save: Apple's own encoder fails with "Invalid data". It is logged, not shown.
- Stills were blocked on the first scan because the phone reaches "fair" heat within seconds; they now stop only at "serious". The second scan kept 28, but only 2016 × 1512: the session runs a 1920 × 1440 video format that isn't recommended for high-resolution capture. Trying the recommended format is next; check it doesn't upset RoomPlan or heat the phone.

Still to check:

- **Keeping the mesh while RoomPlan runs** (`ARHost.restoreDepthAndMesh`): RoomPlan reconfigures the session without depth or the mesh, and the configuration is re-applied every half second. Depth kept arriving on the first scan (no gap over 1.6 s); the mesh is still to check.
- **Copying the mesh before a room stops**, and RoomPlan's `stop(pauseARSession: false)` keeping the world for the next room.
- **White balance:** locked per room through the camera ARKit uses. Check that it stays locked while RoomPlan reconfigures the session; the app puts the lock back, and logs `white_balance_failed` in `log/events.jsonl` if it can't.
- **Speed:** photos are JPEG-encoded on the main thread when a frame becomes the held candidate. If the camera stutters, move this to the encoding queue.
- **Accuracy:** the ±2/4/8 cm per scanner confidence are estimates until tape checks measure them.
