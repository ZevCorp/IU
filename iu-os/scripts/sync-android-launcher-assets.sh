#!/bin/zsh
set -euo pipefail

ROOT="/Users/felipemaldonado/Documents/U/iu-os"
ASSETS="$ROOT/android-launcher/app/src/main/assets/launcher"

cp "$ROOT/renderer/index.html" "$ASSETS/home.html"
cp "$ROOT/renderer/app.js" "$ASSETS/app.js"
cp "$ROOT/renderer/styles.css" "$ASSETS/styles.css"
cp "$ROOT/renderer/chat.html" "$ASSETS/chat.html"
cp "$ROOT/renderer/chat.css" "$ASSETS/chat.css"
cp "$ROOT/renderer/chat.js" "$ASSETS/chat.js"
cp "$ROOT/renderer/qrcode.min.js" "$ASSETS/qrcode.min.js"
cp "$ROOT/assets/hey_pss_pss.mp3" "$ASSETS/assets/hey_pss_pss.mp3"

perl -0pi -e 's#<meta name="viewport" content="width=device-width, initial-scale=1.0">#<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">#' "$ASSETS/home.html"
perl -0pi -e 's#<title>IÜ OS</title>#<title>IÜ Android Launcher</title>#' "$ASSETS/home.html"
perl -0pi -e 's#\n\s*<!-- MediaPipe Tasks Vision \(FaceLandmarker with 52 Blendshapes\) -->.*?</script>##s' "$ASSETS/home.html"
perl -0pi -e 's#\n\s*<!-- Sync Modules -->\n\s*<script src="node_modules/\@picovoice/porcupine-web/index.js"></script>\n\s*<script src="node_modules/\@picovoice/web-voice-processor/index.js"></script>#\n  <script src="android-bridge.js"></script>#s' "$ASSETS/home.html"

perl -0pi -e 's#<meta name="viewport" content="width=device-width, initial-scale=1.0">#<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">#' "$ASSETS/chat.html"
perl -0pi -e 's#<script src="\./chat.js"></script>#<script src="./android-bridge.js"></script>\n  <script src="./chat.js"></script>#' "$ASSETS/chat.html"

echo "Android launcher assets synchronized."
