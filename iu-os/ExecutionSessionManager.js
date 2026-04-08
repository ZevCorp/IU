class ExecutionSessionManager {
    constructor() {
        this.currentSession = null;
        this.sequence = 0;
    }

    startSession(params = {}) {
        const session = {
            id: `exec-${Date.now()}-${++this.sequence}`,
            baseGoal: String(params.goal || ''),
            goal: String(params.goal || ''),
            app: String(params.app || ''),
            executor: String(params.executor || 'iu_desktop'),
            stepsHint: String(params.stepsHint || ''),
            source: String(params.source || 'unknown'),
            status: 'running',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            waitPrompt: '',
            userTurns: [],
            resumeCount: 0,
            pendingTypeText: '',
            pendingTypeLabel: '',
            lastRuntimeContext: null,
            lastExecutionState: null,
            lastSummary: '',
            lastResult: null
        };
        this.currentSession = session;
        return this._clone(session);
    }

    getCurrentSession() {
        return this._clone(this.currentSession);
    }

    getSession(sessionId) {
        if (!this.currentSession || this.currentSession.id !== sessionId) return null;
        return this._clone(this.currentSession);
    }

    hasResumableSession() {
        return !!(this.currentSession && ['running', 'waiting_user', 'interrupted'].includes(this.currentSession.status));
    }

    markRunning(sessionId, params = {}) {
        const session = this._getMutableSession(sessionId);
        if (!session) return null;
        session.status = 'running';
        session.goal = String(params.goal || session.goal || session.baseGoal || '');
        session.app = String(params.app || session.app || '');
        session.executor = String(params.executor || session.executor || 'iu_desktop');
        session.stepsHint = String(params.stepsHint || session.stepsHint || '');
        session.waitPrompt = '';
        session.updatedAt = Date.now();
        return this._clone(session);
    }

    markWaitingUser(sessionId, params = {}) {
        const session = this._getMutableSession(sessionId);
        if (!session) return null;
        session.status = 'waiting_user';
        session.waitPrompt = String(params.waitPrompt || params.summary || session.waitPrompt || '');
        session.lastRuntimeContext = this._cloneValue(params.runtimeContext || session.lastRuntimeContext);
        session.lastExecutionState = this._cloneValue(params.executionState || session.lastExecutionState);
        session.lastSummary = String(params.summary || session.lastSummary || '');
        session.lastResult = this._cloneValue(params.result || session.lastResult);
        session.updatedAt = Date.now();
        this._applyInterruption(session, params.interruption);
        return this._clone(session);
    }

    markInterrupted(sessionId, params = {}) {
        const session = this._getMutableSession(sessionId);
        if (!session) return null;
        session.status = 'interrupted';
        session.lastRuntimeContext = this._cloneValue(params.runtimeContext || session.lastRuntimeContext);
        session.lastExecutionState = this._cloneValue(params.executionState || session.lastExecutionState);
        session.lastSummary = String(params.summary || session.lastSummary || '');
        session.lastResult = this._cloneValue(params.result || session.lastResult);
        session.updatedAt = Date.now();
        this._applyInterruption(session, params.interruption);
        return this._clone(session);
    }

    markCompleted(sessionId, params = {}) {
        const session = this._getMutableSession(sessionId);
        if (!session) return null;
        session.status = 'completed';
        session.waitPrompt = '';
        session.lastRuntimeContext = this._cloneValue(params.runtimeContext || session.lastRuntimeContext);
        session.lastExecutionState = this._cloneValue(params.executionState || session.lastExecutionState);
        session.lastSummary = String(params.summary || session.lastSummary || '');
        session.lastResult = this._cloneValue(params.result || session.lastResult);
        session.updatedAt = Date.now();
        session.pendingTypeText = '';
        session.pendingTypeLabel = '';
        return this._clone(session);
    }

    markFailed(sessionId, params = {}) {
        const session = this._getMutableSession(sessionId);
        if (!session) return null;
        session.status = 'failed';
        session.lastSummary = String(params.summary || params.error || session.lastSummary || '');
        session.lastResult = this._cloneValue(params.result || session.lastResult);
        session.updatedAt = Date.now();
        return this._clone(session);
    }

    appendUserTurn(sessionId, transcript, params = {}) {
        const session = this._getMutableSession(sessionId);
        if (!session) return null;
        const userTurn = {
            at: Date.now(),
            transcript: String(transcript || '').trim(),
            runtimeContext: this._cloneValue(params.runtimeContext || null)
        };
        session.userTurns.push(userTurn);
        session.resumeCount += 1;
        session.updatedAt = Date.now();
        return this._clone(session);
    }

    buildContinuation(sessionId, transcript, params = {}) {
        const session = this._getMutableSession(sessionId);
        if (!session) return null;

        const runtime = this._cloneValue(
            params.runtimeContext ||
            session.lastRuntimeContext ||
            { app: session.app || '', window: '', recentActions: [] }
        );
        const normalizedTranscript = String(transcript || '').trim();
        if (normalizedTranscript) {
            this.appendUserTurn(sessionId, normalizedTranscript, { runtimeContext: runtime });
        }

        const pendingTypeHint = session.pendingTypeText
            ? `\nREANUDACIÓN DE ESCRITURA:\n- Fuiste interrumpido mientras escribías en "${session.pendingTypeLabel || 'campo actual'}".\n- Primero completa exactamente este texto pendiente antes de aplicar la aclaración:\n"${session.pendingTypeText}"`
            : '';
        const runtimeContextHint = `\nCONTEXTO ACTUAL PRIORITARIO:\n- App detectada: "${runtime?.app || session.app || ''}"\n- Ventana/Módulo detectado: "${runtime?.window || ''}"\n- Acciones recientes ya ejecutadas: ${Array.isArray(runtime?.recentActions) && runtime.recentActions.length > 0 ? runtime.recentActions.slice(-6).join(' | ') : 'ninguna'}`;
        const waitPromptHint = session.waitPrompt
            ? `\nBLOQUEO/ESPERA ANTERIOR:\n- ${session.waitPrompt}`
            : '';
        const preservedGoal = String(session.baseGoal || session.goal || '').trim();
        const continuationGoal = preservedGoal || String(session.goal || '').trim();
        const continuationStepsHint = `CONTINUIDAD OBLIGATORIA:
- NO reinicies el flujo ni vuelvas al primer paso.
- NO repitas subobjetivos ya completados o claramente iniciados, salvo instrucción explícita.
- NO limpies o sobrescribas datos ya válidos sin que el usuario lo pida.
- Continúa desde el estado visual actual y aplica la aclaración del usuario de forma localizada.
- Si el estado visual actual está en una etapa posterior, NO pidas datos de etapas anteriores.
- La instrucción explícita más reciente del usuario tiene prioridad sobre el plan anterior.
- Si el usuario acaba de indicar un siguiente paso concreto, NO pidas confirmación redundante tipo sí/no; ejecútalo.
- Si el usuario dijo que ya inició sesión o que ya está dentro, asúmelo y continúa desde ahí.
${normalizedTranscript ? `\nACLARACIÓN DEL USUARIO: "${normalizedTranscript}"` : ''}
${pendingTypeHint}
${runtimeContextHint}
${waitPromptHint}

PASOS BASE ORIGINALES:
${session.stepsHint || ''}`;

        session.goal = continuationGoal;
        session.stepsHint = continuationStepsHint;
        session.status = 'running';
        session.waitPrompt = '';
        session.lastRuntimeContext = this._cloneValue(runtime);
        session.updatedAt = Date.now();

        return {
            session: this._clone(session),
            goal: continuationGoal,
            app: session.app,
            executor: session.executor,
            stepsHint: continuationStepsHint,
            runtimeContext: runtime
        };
    }

    clearCurrentSession() {
        this.currentSession = null;
    }

    toFlow(sessionId) {
        const session = this.getSession(sessionId);
        if (!session) return null;
        return {
            id: session.id,
            goal: session.goal,
            app: session.app,
            executor: session.executor,
            stepsHint: session.stepsHint,
            source: session.source,
            startedAt: session.createdAt,
            awaitingUserInput: session.status === 'waiting_user',
            waitPrompt: session.waitPrompt || '',
            status: session.status,
            resumeCount: session.resumeCount
        };
    }

    toInterruptedFlowContext(sessionId) {
        const session = this.getSession(sessionId);
        if (!session) return null;
        return {
            sessionId: session.id,
            goal: session.goal,
            app: session.app,
            executor: session.executor,
            stepsHint: session.stepsHint,
            pendingTypeText: session.pendingTypeText || '',
            pendingTypeLabel: session.pendingTypeLabel || '',
            runtimeContext: this._cloneValue(session.lastRuntimeContext)
        };
    }

    _applyInterruption(session, interruption) {
        const data = interruption || {};
        session.pendingTypeText = String(data.pendingTypeText || session.pendingTypeText || '');
        session.pendingTypeLabel = String(data.pendingTypeLabel || session.pendingTypeLabel || '');
    }

    _getMutableSession(sessionId) {
        if (!this.currentSession || this.currentSession.id !== sessionId) return null;
        return this.currentSession;
    }

    _clone(value) {
        return this._cloneValue(value);
    }

    _cloneValue(value) {
        if (value == null) return value;
        return JSON.parse(JSON.stringify(value));
    }
}

module.exports = ExecutionSessionManager;
