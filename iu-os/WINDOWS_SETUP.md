# IU OS - Windows Setup (UIA Only)

## Requisitos
- Windows 10/11
- Node.js 18+
- PowerShell 5.1+ (o PowerShell 7)

## Instalacion

```bash
cd iu-os
npm install
npm run dev
```

## Arquitectura Windows implementada

- `ScreenAgent` usa `WindowsCompanionClient` por IPC local JSON-RPC con proceso PowerShell.
- `windows/windows-companion.ps1` implementa extraccion y acciones con Windows UI Automation (UIA).
- En esta etapa, Windows corre en modo **UIA-only**.

## Alcance actual en Windows

- Extraccion de arbol UI nativo (UIA).
- Deteccion de elementos interactivos.
- Acciones semanticas Windows-first:
  - `invoke`
  - `focus`
  - `setValue`
  - `select`
  - `expand`
  - `collapse`
  - `toggle`
  - `scroll`
- Fallback fisico a click por coordenada solo cuando el patron semantico no existe.

## Desactivado en esta fase

- Screenshot fallback
- OCR
- Vision fallback
- Heuristicas visuales

## Troubleshooting rapido

1. Si no conecta el companion:
   - Verifica que `powershell.exe` exista en PATH.
   - Revisa logs de `WindowsCompanion` en consola.
2. Si no encuentra elementos:
   - Abre la app objetivo y dejala en primer plano.
   - Prueba cambiando el nombre de app al usar `switch_app`.
