# U Workspace

Raiz organizada del workspace. Proyectos activos y experimentos separados.

## Estructura

- `iu-os/`: proyecto principal (no tocado)
- `server/`: backend critico (Render)
- `projects/iu-web/`: frontend web legacy/POC (Vite)
- `docs/`: documentacion general
- `archive/`: experimentos y legados archivados

## Ejecutar proyectos activos

### IU Web (Vite)

```bash
cd /Users/felipemaldonado/Documents/U/projects/iu-web
npm install
npm run dev
```

### Backend Server

```bash
cd /Users/felipemaldonado/Documents/U/server
npm install
npm run dev
```

## Convencion de organizacion

- Todo proyecto nuevo va en `projects/<nombre-proyecto>/`
- Todo experimento descartado va en `archive/experiments/<nombre>/`
- Logs o archivos historicos van en `archive/logs/`
- Evitar archivos sueltos en la raiz
