const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NotebookExecutionManager = require('../NotebookExecutionManager');

function createManager() {
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-notebooks-'));
    const manager = new NotebookExecutionManager({
        storageDir,
        isModelReady: () => false,
        now: (() => {
            let current = 1700000000000;
            return () => current++;
        })()
    });
    return { manager, storageDir };
}

test('NotebookExecutionManager bootstraps with a persisted initial tab and execution', () => {
    const { manager, storageDir } = createManager();
    const first = manager.bootstrap();

    assert.equal(first.tabs.length, 1);
    assert.equal(first.executions.length, 1);
    assert.ok(fs.existsSync(path.join(storageDir, 'notebooks.json')));

    const reloaded = new NotebookExecutionManager({
        storageDir,
        isModelReady: () => false
    }).bootstrap();

    assert.equal(reloaded.tabs.length, 1);
    assert.equal(reloaded.executions.length, 1);
    assert.equal(reloaded.activeTabId, first.activeTabId);
});

test('createTab creates a default execution bound to the new tab', () => {
    const { manager } = createManager();
    manager.bootstrap();

    const result = manager.createTab({ templateId: 'blank', title: 'Apuntes' });

    assert.equal(result.state.tabs.length, 2);
    assert.equal(result.state.executions.length, 2);
    assert.equal(result.execution.tabId, result.tab.id);
    assert.equal(result.state.activeExecutionId, result.execution.id);
    assert.match(result.execution.title, /Chat · Apuntes/);
});

test('archiveTab hides a tab immediately and purges it after retention', () => {
    let current = 1700000000000;
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-notebooks-'));
    const manager = new NotebookExecutionManager({
        storageDir,
        isModelReady: () => false,
        archiveRetentionMs: 7 * 24 * 60 * 60 * 1000,
        now: () => current
    });

    const first = manager.bootstrap();
    const archivedTabId = first.activeTabId;
    const archivedExecutionId = first.activeExecutionId;

    const stateAfterArchive = manager.archiveTab(archivedTabId);
    assert.equal(stateAfterArchive.tabs.some((tab) => tab.id === archivedTabId), false);
    assert.equal(stateAfterArchive.executions.some((execution) => execution.id === archivedExecutionId), false);
    assert.equal(stateAfterArchive.tabs.length >= 1, true);

    current += 8 * 24 * 60 * 60 * 1000;
    const reloaded = new NotebookExecutionManager({
        storageDir,
        isModelReady: () => false,
        archiveRetentionMs: 7 * 24 * 60 * 60 * 1000,
        now: () => current
    }).bootstrap();

    assert.equal(reloaded.tabs.some((tab) => tab.id === archivedTabId), false);
});

test('reassignExecution moves a chat to another tab without losing messages', () => {
    const { manager } = createManager();
    const initial = manager.bootstrap();
    const secondTab = manager.createTab({ templateId: 'blank', title: 'Otra hoja' }).tab;
    const originalExecutionId = initial.executions[0].id;

    manager.appendMessage(originalExecutionId, { role: 'user', text: 'Necesito ayuda con Canvas.' });
    manager.appendMessage(originalExecutionId, { role: 'assistant', text: 'Voy a revisar la materia.' });
    const moved = manager.reassignExecution(originalExecutionId, secondTab.id);

    assert.equal(moved.execution.tabId, secondTab.id);
    assert.equal(moved.execution.messages.length, 2);
    assert.match(moved.execution.title, /Necesito ayuda con Canvas/);
});

test('toggleVariablePersistence preserves a manual persistence preference', async () => {
    const { manager } = createManager();
    const state = manager.bootstrap();
    const tabId = state.activeTabId;
    const executionId = state.activeExecutionId;

    await manager.analyzeVariables({
        tabId,
        executionId,
        title: 'Trabajo universitario',
        body: 'Acceso a Canvas: entrar con mi flujo habitual.\nMateria actual: Business Intelligence\n'
    });

    const toggled = manager.toggleVariablePersistence({
        tabId,
        executionId,
        key: 'materia_actual',
        persistent: true
    });

    const tab = toggled.state.tabs.find((item) => item.id === tabId);
    const execution = toggled.state.executions.find((item) => item.id === executionId);
    const variable = tab.variables.find((item) => item.key === 'materia_actual');

    assert.equal(Boolean(variable), true);
    assert.equal(variable.persistent, true);
    assert.equal(variable.manualPersistence, true);
    assert.equal(execution.resolvedVariables.some((item) => item.key === 'materia_actual'), false);
});

test('analyzeVariables infers note and chat variables and flags only critical missing data', async () => {
    const { manager } = createManager();
    const state = manager.bootstrap();
    const tabId = state.activeTabId;
    const executionId = state.activeExecutionId;

    manager.appendMessage(executionId, {
        role: 'user',
        text: 'Es para la materia Business Intelligence y el trabajo es un ensayo.'
    });

    const result = await manager.analyzeVariables({
        tabId,
        executionId,
        title: 'Trabajo universitario',
        body: [
            'Acceso a Canvas: entra a canvas con mi flujo habitual.',
            'Materia actual:',
            'Tipo de trabajo:',
            'Tema o consigna: Analisis de datos en retail'
        ].join('\n')
    });

    const materia = result.variables.find((item) => item.key === 'materia_actual');
    const tipo = result.variables.find((item) => item.key === 'tipo_de_trabajo');
    const acceso = result.variables.find((item) => item.key === 'acceso_a_canvas');

    assert.equal(materia.value, 'Business Intelligence');
    assert.equal(tipo.value.toLowerCase(), 'ensayo');
    assert.equal(acceso.persistent, true);
    assert.equal(result.needsClarification, false);
});
