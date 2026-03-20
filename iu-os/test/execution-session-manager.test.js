const test = require('node:test');
const assert = require('node:assert/strict');

const ExecutionSessionManager = require('../ExecutionSessionManager');

test('ExecutionSessionManager keeps a resumable waiting session', () => {
    const manager = new ExecutionSessionManager();
    const session = manager.startSession({
        goal: 'Subir trabajo en Canvas',
        app: 'Chrome',
        stepsHint: 'Ir a Canvas y subir el archivo.',
        source: 'explicit'
    });

    manager.markWaitingUser(session.id, {
        waitPrompt: 'Necesito que completes el login.',
        runtimeContext: { app: 'Chrome', window: 'Login', recentActions: ['click login'] },
        executionState: { stage: 'login_required', turn: 'user', blocker: 'login' },
        interruption: { pendingTypeText: 'user@example.com', pendingTypeLabel: 'correo' }
    });

    const current = manager.getCurrentSession();
    assert.equal(current.status, 'waiting_user');
    assert.equal(current.waitPrompt, 'Necesito que completes el login.');
    assert.equal(current.pendingTypeLabel, 'correo');
    assert.equal(current.lastExecutionState.stage, 'login_required');
    assert.equal(manager.hasResumableSession(), true);
});

test('ExecutionSessionManager builds continuation without losing session identity', () => {
    const manager = new ExecutionSessionManager();
    const session = manager.startSession({
        goal: 'Subir trabajo en Canvas',
        app: 'Chrome',
        stepsHint: 'Ir a Canvas y subir el archivo.',
        source: 'explicit'
    });

    manager.markWaitingUser(session.id, {
        waitPrompt: 'Necesito que completes el login.',
        runtimeContext: { app: 'Chrome', window: 'Canvas', recentActions: ['abrir estudiantes', 'entrar a ubeflex'] },
        interruption: { pendingTypeText: '', pendingTypeLabel: '' }
    });

    const continuation = manager.buildContinuation(session.id, 'Ya estoy dentro. Ve a Canvas y busca Business Intelligence.', {
        runtimeContext: { app: 'Chrome', window: 'Canvas Home', recentActions: ['login completado'] }
    });

    assert.equal(continuation.session.id, session.id);
    assert.equal(continuation.app, 'Chrome');
    assert.match(continuation.goal, /Ya estoy dentro/);
    assert.match(continuation.stepsHint, /NO reinicies el flujo/);
    assert.match(continuation.stepsHint, /Business Intelligence/);
    assert.equal(continuation.session.resumeCount, 1);
    assert.equal(continuation.session.status, 'running');
});
