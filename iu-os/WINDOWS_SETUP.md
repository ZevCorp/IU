# IÜ OS - Windows Setup

## Requisitos
- Node.js 18+ (https://nodejs.org)
- Git

## Instalación (Terminal/PowerShell)

```bash
# 1. Clonar el repo
git clone <tu-repo-url>
cd iu-os

# 2. Instalar dependencias
npm install

# 3. Instalar navegador Playwright
npx playwright install chromium

# 4. Ejecutar
npm run dev
```

## Qué funciona en Windows
✅ Electron overlay window  
✅ Playwright + ChatGPT  
✅ Voice conversations  
✅ Transcription monitoring  
✅ Intent predictions  

## Qué NO funciona en Windows
❌ Screen Context Capture (AX Tree) - solo macOS  

## Troubleshooting

### Error de permisos de micrófono
Windows pedirá permisos de micrófono cuando ChatGPT intente usar voz.
Acepta el permiso en el navegador.

### El navegador no abre
```bash
npx playwright install chromium --force
```
