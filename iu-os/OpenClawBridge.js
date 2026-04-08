'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_OPENCLAW_HOME = path.join(os.homedir(), '.openclaw');
const DEFAULT_OPENCLAW_CONFIG_PATH = path.join(DEFAULT_OPENCLAW_HOME, 'openclaw.json');
const IMPORT_SOURCE = 'openclaw_import';
const IMPORT_MANIFEST_FILENAME = 'openclaw_import_manifest.json';
const OPENCLAW_CONFIG_DOCUMENT_ID = '__openclaw_config__';
const OPENCLAW_MEMORY_IMPORT_FILENAME = 'openclaw-memory.md';

const IDENTITY_FILES = new Set(['IDENTITY.md', 'USER.md', 'SOUL.md']);
const RUNTIME_FILES = new Set(['AGENTS.md', 'TOOLS.md', 'BOOTSTRAP.md', 'HEARTBEAT.md', 'OPENCLAW_CONFIG.md']);

function safeTrim(value) {
    return String(value || '').trim();
}

function resolveOpenClawHome() {
    return safeTrim(process.env.IU_OPENCLAW_HOME) || DEFAULT_OPENCLAW_HOME;
}

function resolveOpenClawConfigPath() {
    const explicit = safeTrim(process.env.IU_OPENCLAW_CONFIG_PATH);
    if (explicit) return explicit;
    return path.join(resolveOpenClawHome(), 'openclaw.json');
}

function loadOpenClawConfig() {
    const configPath = resolveOpenClawConfigPath();
    try {
        if (!configPath || !fs.existsSync(configPath)) {
            return {
                found: false,
                configPath,
                config: null,
                workspaceDir: '',
                workspaceFiles: []
            };
        }
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const workspaceDir = safeTrim(config?.agents?.defaults?.workspace) || path.join(resolveOpenClawHome(), 'workspace');
        return {
            found: true,
            configPath,
            config,
            workspaceDir,
            workspaceFiles: collectMarkdownFiles(workspaceDir)
        };
    } catch (error) {
        return {
            found: false,
            configPath,
            config: null,
            workspaceDir: '',
            workspaceFiles: [],
            error: error?.message || String(error)
        };
    }
}

function relativeOpenClawPath(workspaceDir, filePath) {
    return path.relative(workspaceDir, filePath).replace(/\\/g, '/');
}

function categorizeOpenClawDocument(relativePath) {
    if (relativePath === OPENCLAW_CONFIG_DOCUMENT_ID) return 'config';
    const cleanPath = String(relativePath || '').replace(/\\/g, '/');
    const fileName = path.basename(cleanPath);
    if (cleanPath.startsWith('memory/')) return 'memory';
    if (IDENTITY_FILES.has(fileName)) return 'identity';
    if (RUNTIME_FILES.has(fileName)) return 'runtime';
    return 'workspace';
}

function getSemanticMemoryBridge() {
    return {
        memoryFS: require('./MemoryFileSystem'),
        vectorIndex: require('./VectorIndex')
    };
}

function collectMarkdownFiles(rootDir, maxDepth = 4) {
    const files = [];
    function walk(currentDir, depth) {
        if (!currentDir || depth > maxDepth || !fs.existsSync(currentDir)) return;
        let entries = [];
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch (_) {
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath, depth + 1);
                continue;
            }
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
            files.push(fullPath);
        }
    }
    walk(rootDir, 0);
    return files.sort();
}

function deriveNoteTitle(filePath, body) {
    const heading = String(body || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith('# '));
    if (heading) {
        return heading.replace(/^#\s+/, '').replace(/\s+-\s+.*$/, '').replace(/\.md\b/i, '').trim();
    }
    return path.basename(filePath, path.extname(filePath)).replace(/\.md\b/i, '').trim();
}

function redactSecrets(value, keyName = '') {
    const key = String(keyName || '').toLowerCase();
    const shouldRedact = ['token', 'password', 'secret', 'apikey', 'api_key'].some((part) => key.includes(part));
    if (shouldRedact) return '[redacted]';
    if (Array.isArray(value)) return value.map((item) => redactSecrets(item, keyName));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactSecrets(childValue, childKey)]));
    }
    return value;
}

function buildOpenClawConfigNote(configPath, config, workspaceDir) {
    const safeConfig = redactSecrets(config || {});
    return [
        '# OpenClaw Configuration',
        '',
        'Resumen importado desde tu instalacion local de OpenClaw para que Ü pueda usarlo como contexto operativo.',
        '',
        `- Config path: \`${configPath}\``,
        `- Workspace: \`${workspaceDir}\``,
        '',
        '```json',
        JSON.stringify(safeConfig, null, 2),
        '```'
    ].join('\n');
}

function scanOpenClawWorkspace() {
    const discovery = loadOpenClawConfig();
    if (!discovery.found || !discovery.config) {
        return {
            ok: false,
            found: false,
            reason: discovery.error || 'OpenClaw config not found',
            configPath: discovery.configPath,
            workspaceDir: discovery.workspaceDir || '',
            documents: [],
            counts: {
                total: 0,
                memory: 0,
                identity: 0,
                runtime: 0,
                workspace: 0,
                config: 0
            }
        };
    }

    const documents = [];
    for (const filePath of discovery.workspaceFiles) {
        let body = '';
        let stat = null;
        try {
            body = fs.readFileSync(filePath, 'utf8');
            stat = fs.statSync(filePath);
        } catch (_) {
            continue;
        }
        const relativePath = relativeOpenClawPath(discovery.workspaceDir, filePath);
        documents.push({
            documentId: relativePath,
            relativePath,
            absolutePath: filePath,
            category: categorizeOpenClawDocument(relativePath),
            title: deriveNoteTitle(filePath, body),
            charCount: body.length,
            updatedAt: stat.mtime.toISOString()
        });
    }

    let configUpdatedAt = null;
    try {
        configUpdatedAt = fs.statSync(discovery.configPath).mtime.toISOString();
    } catch (_) {
        configUpdatedAt = new Date().toISOString();
    }
    documents.push({
        documentId: OPENCLAW_CONFIG_DOCUMENT_ID,
        relativePath: 'openclaw.json',
        absolutePath: discovery.configPath,
        category: 'config',
        title: 'OpenClaw Config',
        charCount: JSON.stringify(redactSecrets(discovery.config || {}), null, 2).length,
        updatedAt: configUpdatedAt
    });

    const counts = {
        total: documents.length,
        memory: documents.filter((document) => document.category === 'memory').length,
        identity: documents.filter((document) => document.category === 'identity').length,
        runtime: documents.filter((document) => document.category === 'runtime').length,
        workspace: documents.filter((document) => document.category === 'workspace').length,
        config: documents.filter((document) => document.category === 'config').length
    };

    return {
        ok: true,
        found: true,
        configPath: discovery.configPath,
        workspaceDir: discovery.workspaceDir,
        documents,
        counts
    };
}

function resolveOpenClawDocument(documentId) {
    const scan = scanOpenClawWorkspace();
    if (!scan.ok) {
        return {
            ok: false,
            error: scan.reason || 'No encontré la instalación local de OpenClaw.'
        };
    }
    const wantedId = safeTrim(documentId);
    const document = scan.documents.find((entry) => entry.documentId === wantedId) || null;
    if (!document) {
        return { ok: false, error: `No encontré el documento ${wantedId || 'solicitado'}.` };
    }
    return { ok: true, scan, document };
}

function readOpenClawDocument(documentId, maxChars = 24000) {
    const resolved = resolveOpenClawDocument(documentId);
    if (!resolved.ok) return resolved;

    const { scan, document } = resolved;
    let body = '';
    if (document.documentId === OPENCLAW_CONFIG_DOCUMENT_ID) {
        const discovery = loadOpenClawConfig();
        body = buildOpenClawConfigNote(discovery.configPath, discovery.config, discovery.workspaceDir);
    } else {
        body = fs.readFileSync(document.absolutePath, 'utf8');
    }

    return {
        ok: true,
        configPath: scan.configPath,
        workspaceDir: scan.workspaceDir,
        document: {
            ...document,
            body: String(body || '').slice(0, Math.max(500, Math.min(60000, Number(maxChars || 24000))))
        }
    };
}

function readImportManifest(storageDir) {
    const manifestPath = path.join(storageDir, IMPORT_MANIFEST_FILENAME);
    try {
        if (!fs.existsSync(manifestPath)) {
            return { notes: {}, metas: {} };
        }
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return {
            notes: parsed?.notes && typeof parsed.notes === 'object' ? parsed.notes : {},
            metas: parsed?.metas && typeof parsed.metas === 'object' ? parsed.metas : {}
        };
    } catch (_) {
        return { notes: {}, metas: {} };
    }
}

function writeImportManifest(storageDir, manifest) {
    const manifestPath = path.join(storageDir, IMPORT_MANIFEST_FILENAME);
    fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function findImportedNote(state, noteId) {
    return (Array.isArray(state?.tabs) ? state.tabs : []).find((note) => String(note?.id || '').trim() === String(noteId || '').trim()) || null;
}

function findImportedMeta(state, metaId) {
    return (Array.isArray(state?.metas) ? state.metas : []).find((meta) => String(meta?.id || '').trim() === String(metaId || '').trim()) || null;
}

function buildMetaDefinitions(noteEntries = []) {
    const allIds = noteEntries.map((item) => item.noteId).filter(Boolean);
    const identityIds = noteEntries.filter((item) => IDENTITY_FILES.has(item.fileName)).map((item) => item.noteId).filter(Boolean);
    const runtimeIds = noteEntries.filter((item) => RUNTIME_FILES.has(item.fileName)).map((item) => item.noteId).filter(Boolean);

    return [
        {
            key: 'openclaw_workspace',
            title: 'OpenClaw Workspace',
            description: 'Conjunto de markdowns importados desde la instalacion local de OpenClaw.',
            noteIds: allIds
        },
        {
            key: 'openclaw_identity',
            title: 'OpenClaw Identity',
            description: 'Identidad, usuario y alma importados desde OpenClaw.',
            noteIds: identityIds
        },
        {
            key: 'openclaw_runtime',
            title: 'OpenClaw Runtime',
            description: 'Archivos operativos y de configuracion importados desde OpenClaw.',
            noteIds: runtimeIds
        }
    ].filter((meta) => meta.noteIds.length > 0);
}

async function upsertImportedNote(knowledgeService, manifest, externalKey, title, body, sourcePath, updatedAt) {
    const entry = manifest.notes[externalKey] || {};
    const state = knowledgeService.getKnowledgeState();
    const existing = entry.noteId ? findImportedNote(state, entry.noteId) : null;

    if (existing) {
        const needsUpdate = String(existing.title || '') !== title || String(existing.body || '') !== body;
        if (needsUpdate) {
            const updated = knowledgeService.updateNote(existing.id, {
                title,
                body,
                source: IMPORT_SOURCE
            });
            manifest.notes[externalKey] = {
                noteId: updated?.note?.id || existing.id,
                sourcePath,
                updatedAt
            };
            return manifest.notes[externalKey].noteId;
        }
        manifest.notes[externalKey] = {
            noteId: existing.id,
            sourcePath,
            updatedAt
        };
        return existing.id;
    }

    const created = knowledgeService.createNote({
        title,
        body,
        source: IMPORT_SOURCE
    });
    const noteId = created?.note?.id || '';
    if (noteId) {
        manifest.notes[externalKey] = {
            noteId,
            sourcePath,
            updatedAt
        };
    }
    return noteId;
}

function upsertImportedMeta(knowledgeService, manifest, definition) {
    const state = knowledgeService.getKnowledgeState();
    const existing = manifest.metas[definition.key] ? findImportedMeta(state, manifest.metas[definition.key]) : null;

    if (existing) {
        const updated = knowledgeService.updateMeta(existing.id, {
            title: definition.title,
            description: definition.description,
            manualNoteIds: definition.noteIds,
            agentNoteIds: [],
            excludedNoteIds: [],
            source: IMPORT_SOURCE
        });
        manifest.metas[definition.key] = updated?.id || existing.id;
        return manifest.metas[definition.key];
    }

    const created = knowledgeService.createMeta({
        title: definition.title,
        description: definition.description,
        noteIds: definition.noteIds,
        manualNoteIds: definition.noteIds,
        source: IMPORT_SOURCE
    });
    if (created?.id) {
        manifest.metas[definition.key] = created.id;
    }
    return created?.id || null;
}

async function importOpenClawDocuments(options = {}) {
    const knowledgeService = options.knowledgeService;
    if (!knowledgeService) {
        return { ok: false, error: 'knowledgeService is required' };
    }

    const scan = scanOpenClawWorkspace();
    if (!scan.ok) {
        return {
            ok: false,
            skipped: true,
            reason: scan.reason || 'OpenClaw config not found'
        };
    }

    const requestedIds = Array.isArray(options.documentIds) && options.documentIds.length > 0
        ? options.documentIds.map((value) => safeTrim(value)).filter(Boolean)
        : scan.documents.map((document) => document.documentId);
    const documents = requestedIds
        .map((documentId) => scan.documents.find((entry) => entry.documentId === documentId) || null)
        .filter(Boolean);

    if (documents.length === 0) {
        return { ok: false, error: 'No hay documentos de OpenClaw para importar.' };
    }

    const storageDir = knowledgeService.storageDir || path.join(process.cwd(), '.chat-notebooks');
    const manifest = readImportManifest(storageDir);
    const targetMetaId = safeTrim(options.targetMetaId);
    const imported = [];

    for (const document of documents) {
        let body = '';
        if (document.documentId === OPENCLAW_CONFIG_DOCUMENT_ID) {
            const discovery = loadOpenClawConfig();
            body = buildOpenClawConfigNote(discovery.configPath, discovery.config, discovery.workspaceDir);
        } else {
            body = fs.readFileSync(document.absolutePath, 'utf8');
        }

        const externalKey = document.documentId === OPENCLAW_CONFIG_DOCUMENT_ID
            ? 'config:openclaw.json'
            : `workspace:${document.relativePath}`;
        const noteId = await upsertImportedNote(
            knowledgeService,
            manifest,
            externalKey,
            document.title,
            body,
            document.absolutePath,
            document.updatedAt
        );
        if (!noteId) continue;

        if (targetMetaId) {
            knowledgeService.attachNoteToMeta(targetMetaId, noteId, { source: IMPORT_SOURCE });
        }

        imported.push({
            documentId: document.documentId,
            noteId,
            title: document.title,
            category: document.category
        });
    }

    writeImportManifest(storageDir, manifest);

    return {
        ok: true,
        importedCount: imported.length,
        imported,
        targetMetaId: targetMetaId || null
    };
}

async function syncOpenClawMemoryToSemanticMemory(options = {}) {
    const scan = scanOpenClawWorkspace();
    if (!scan.ok) {
        return {
            ok: false,
            skipped: true,
            reason: scan.reason || 'OpenClaw config not found'
        };
    }

    const requestedIds = Array.isArray(options.documentIds) && options.documentIds.length > 0
        ? new Set(options.documentIds.map((value) => safeTrim(value)).filter(Boolean))
        : null;
    const memoryDocuments = scan.documents.filter((document) => {
        if (document.category !== 'memory') return false;
        if (!requestedIds) return true;
        return requestedIds.has(document.documentId);
    });

    if (memoryDocuments.length === 0) {
        return {
            ok: true,
            skipped: true,
            importedMemoryDocuments: 0,
            memoryPath: ''
        };
    }

    const sections = [
        '# OpenClaw Imported Memory',
        '',
        'Este archivo consolida memoria importada desde `~/.openclaw/workspace/memory` para el índice semántico de Ü.',
        ''
    ];
    for (const document of memoryDocuments) {
        const body = fs.readFileSync(document.absolutePath, 'utf8');
        sections.push(`## ${document.title}`);
        sections.push('');
        sections.push(`Source: \`${document.relativePath}\``);
        sections.push('');
        sections.push(String(body || '').trim());
        sections.push('');
    }

    const { memoryFS, vectorIndex } = getSemanticMemoryBridge();
    const memoryPath = memoryFS.writeImportMemory(OPENCLAW_MEMORY_IMPORT_FILENAME, sections.join('\n'));
    await vectorIndex.rebuildIndex();

    return {
        ok: true,
        skipped: false,
        importedMemoryDocuments: memoryDocuments.length,
        memoryPath
    };
}

async function importOpenClawWorkspace(options = {}) {
    const knowledgeService = options.knowledgeService;
    if (!knowledgeService) {
        return { ok: false, error: 'knowledgeService is required' };
    }

    const scan = scanOpenClawWorkspace();
    if (!scan.ok) {
        return {
            ok: false,
            skipped: true,
            reason: scan.reason || 'OpenClaw config not found'
        };
    }

    const importResult = await importOpenClawDocuments({
        knowledgeService,
        documentIds: scan.documents.map((document) => document.documentId)
    });
    if (!importResult?.ok) {
        return importResult;
    }

    const importedEntries = importResult.imported.map((entry) => ({
        externalKey: entry.documentId === OPENCLAW_CONFIG_DOCUMENT_ID
            ? 'config:openclaw.json'
            : `workspace:${entry.documentId}`,
        fileName: entry.documentId === OPENCLAW_CONFIG_DOCUMENT_ID
            ? 'OPENCLAW_CONFIG.md'
            : path.basename(entry.documentId),
        noteId: entry.noteId
    }));

    const metaDefinitions = buildMetaDefinitions(importedEntries);
    const storageDir = knowledgeService.storageDir || path.join(process.cwd(), '.chat-notebooks');
    const manifest = readImportManifest(storageDir);
    const metaIds = metaDefinitions.map((definition) => upsertImportedMeta(knowledgeService, manifest, definition)).filter(Boolean);
    writeImportManifest(storageDir, manifest);
    const memoryResult = await syncOpenClawMemoryToSemanticMemory();

    return {
        ok: true,
        importedNotes: importedEntries.length,
        importedMetas: metaIds.length,
        importedMemoryDocuments: Number(memoryResult?.importedMemoryDocuments || 0),
        workspaceDir: scan.workspaceDir,
        configPath: scan.configPath
    };
}

module.exports = {
    IMPORT_SOURCE,
    OPENCLAW_CONFIG_DOCUMENT_ID,
    loadOpenClawConfig,
    scanOpenClawWorkspace,
    readOpenClawDocument,
    importOpenClawDocuments,
    syncOpenClawMemoryToSemanticMemory,
    importOpenClawWorkspace,
    resolveOpenClawConfigPath,
    resolveOpenClawHome
};
