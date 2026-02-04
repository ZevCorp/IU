# IÜ OS - Build & Distribution

## Development
```bash
npm run dev
```

## Build for Windows (Portable .exe)
```bash
npm run build
```

This will:
1. Obfuscate JavaScript files
2. Package app with electron-builder
3. Output to `dist/IU-{version}-Windows.exe`

## Restore Original Files (after build)
```bash
node scripts/restore.js
```

## Publish to GitHub Releases
```bash
# Set GitHub token
export GH_TOKEN=your_github_token

# Build and publish
npm run publish
```

## User Installation (Windows)
Users can install with one command:
```powershell
irm https://iu.space/install | iex
```

This script:
1. Downloads latest release from GitHub
2. Installs to `%LOCALAPPDATA%\Programs\IU\`
3. Creates desktop shortcut
4. Launches the app

## Auto-Updates
The app checks for updates on startup. Users can also manually check via the UI.

When an update is available:
1. `update-available` event fires → show notification
2. User clicks "Update" → `downloadUpdate()` called
3. `update-downloaded` event fires → show "Restart to update"
4. User clicks "Install" → `installUpdate()` called

## Icon
Place your app icon at `assets/icon.ico` (256x256 recommended)
