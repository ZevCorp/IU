# IU iOS (TrueDepth)

iOS app for Ü with:
- ARKit TrueDepth face tracking (`ARFaceTrackingConfiguration`)
- Vector face renderer in a local `WKWebView` (same Bezier/SVG logic style as desktop)
- Dopaminic interaction layer (human-like expressive behavior)

## Run

1. Install XcodeGen (`brew install xcodegen`)
2. Generate project:
   - `cd /Users/felipemaldonado/Documents/U/apps/iu-ios`
   - `xcodegen generate`
3. Open `IUFace.xcodeproj` in Xcode
4. Run on an iPhone with TrueDepth camera (simulator does not support face tracking)

## Structure

- `Sources/App`: SwiftUI app shell
- `Sources/Tracking`: ARKit TrueDepth capture
- `Sources/Model`: shared face state + Dopaminic engine
- `Sources/Face`: WebView bridge + renderer integration
- `Sources/Resources/u_face_renderer.html`: vector face

## Notes

- If TrueDepth is unavailable, the app shows a fallback message.
- Gesture-to-expression logic is intentionally separated in `DopaminicEngine.swift` to stay maintainable and portable.
