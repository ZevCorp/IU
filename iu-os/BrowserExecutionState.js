'use strict';

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function includesAny(haystack, patterns) {
    return patterns.some((pattern) => haystack.includes(pattern));
}

function countMatches(haystack, patterns) {
    return patterns.reduce((count, pattern) => count + (haystack.includes(pattern) ? 1 : 0), 0);
}

function collectSignals(elements = []) {
    const labels = [];
    for (const element of elements) {
        labels.push(normalizeText(element?.label));
        labels.push(normalizeText(element?.text));
        labels.push(normalizeText(element?.type));
        labels.push(normalizeText(element?.role));
    }
    return labels.filter(Boolean).join(' ');
}

function detectBrowserExecutionState(input = {}) {
    const goalText = normalizeText(`${input.goal || ''} ${input.stepsHint || ''}`);
    const urlText = normalizeText(input.url || '');
    const elementsText = collectSignals(input.elements);
    const signalText = `${urlText} ${elementsText}`.trim();

    const wantsUpload = includesAny(goalText, ['subir', 'upload', 'adjuntar', 'entrega', 'trabajo', 'archivo']);
    const loginPatterns = [
        'iniciar sesion',
        'inicia sesion',
        'login',
        'sign in',
        'password',
        'contrasena',
        'usuario',
        'correo',
        'email',
        'autenticacion',
        'autenticacion',
        'auth',
        'huella'
    ];
    const filePatterns = [
        'seleccionar archivo',
        'adjuntar archivo',
        'subir archivo',
        'choose file',
        'pick file',
        'browse',
        'examinar',
        'archivo'
    ];
    const metadataPatterns = [
        'titulo',
        'descripcion',
        'asignatura',
        'profesor',
        'materia'
    ];
    const successPatterns = [
        'subida completada',
        'entregado',
        'enviado',
        'completado',
        'success',
        'finalizado'
    ];
    const waitingPatterns = [
        'cargando',
        'loading',
        'please wait',
        'procesando',
        'espere',
        'esperando'
    ];
    const platformChoicePatterns = [
        'canvas',
        'moodle',
        'blackboard',
        'aula virtual',
        'lms',
        'campus virtual'
    ];
    const assignmentTargetPatterns = [
        'curso',
        'clase',
        'asignatura',
        'materia',
        'tarea',
        'actividad',
        'entrega',
        'archivo',
        'adjunto'
    ];
    const sharepointHubPatterns = [
        'sharepoint',
        'ubflex',
        'ubeflex',
        'ceipaeduco'
    ];

    const loginSignalCount = countMatches(signalText, loginPatterns);
    const fileSignalCount = countMatches(elementsText, filePatterns);
    const metadataSignalCount = countMatches(elementsText, metadataPatterns);
    const successSignals = includesAny(signalText, successPatterns);
    const waitingSignals = includesAny(signalText, waitingPatterns);
    const platformExplicitInGoal = includesAny(goalText, platformChoicePatterns);
    const assignmentExplicitInGoal = includesAny(goalText, assignmentTargetPatterns);
    const sharepointHubVisible = includesAny(urlText, ['sharepoint', 'ceipaeduco', 'sites ubflex esic']);
    const canvasVisible = includesAny(signalText, ['canvas']);
    const loginSignals =
        loginSignalCount >= 2 ||
        includesAny(urlText, ['login microsoftonline com', 'signin', 'saml2', 'oauth2', 'auth']);

    if (successSignals) {
        return {
            stage: 'success',
            blocker: 'none',
            turn: 'assistant',
            requiresUserTurn: false,
            summary: 'La interfaz indica que la tarea parece completada o confirmada.',
            confidence: 0.9
        };
    }

    if (loginSignals) {
        return {
            stage: 'login_required',
            blocker: 'login_required',
            turn: 'user',
            requiresUserTurn: true,
            missingFields: 'inicio_de_sesion',
            summary: 'La interfaz actual está bloqueada por autenticación.',
            userMessage: 'Necesito que inicies sesión en esta página ahora. Cuando termines, yo continúo.',
            confidence: 0.96
        };
    }

    if (wantsUpload && fileSignalCount >= 1 && includesAny(elementsText, ['seleccionar archivo', 'adjuntar archivo', 'choose file', 'pick file', 'browse', 'examinar'])) {
        return {
            stage: 'file_required',
            blocker: 'file_required',
            turn: 'user',
            requiresUserTurn: true,
            missingFields: 'archivo',
            summary: 'La interfaz pide seleccionar o adjuntar un archivo.',
            userMessage: 'Necesito que selecciones o adjuntes el archivo ahora. Cuando quede elegido, yo continúo.',
            confidence: 0.92
        };
    }

    if (wantsUpload && metadataSignalCount >= 2) {
        return {
            stage: 'metadata_required',
            blocker: 'metadata_required',
            turn: 'user',
            requiresUserTurn: true,
            missingFields: 'titulo, descripcion, asignatura, profesor',
            summary: 'La interfaz muestra el formulario de entrega y faltan datos del trabajo.',
            userMessage: 'Ya llegué al formulario de entrega. Necesito título, descripción, asignatura y profesor si aplica para continuar.',
            confidence: 0.82
        };
    }

    if (wantsUpload && sharepointHubVisible && !loginSignals && !canvasVisible && fileSignalCount === 0 && metadataSignalCount === 0 && !platformExplicitInGoal) {
        return {
            stage: 'portal_choice_required',
            blocker: 'portal_choice_required',
            turn: 'user',
            requiresUserTurn: true,
            missingFields: assignmentExplicitInGoal
                ? 'siguiente_plataforma_o_seccion'
                : 'siguiente_plataforma_o_seccion, curso, tarea',
            summary: 'La tarea llegó a un portal intermedio y la siguiente plataforma o sección no está suficientemente clara.',
            userMessage: assignmentExplicitInGoal
                ? 'Ya llegué al portal intermedio, pero no es claro qué sección debo abrir ahora. Dime qué opción sigue exactamente.'
                : 'Ya llegué al portal intermedio. Dime qué opción sigue ahora, por ejemplo Canvas, y si ya lo sabes también el curso y la tarea.',
            confidence: 0.86
        };
    }

    if (waitingSignals) {
        return {
            stage: 'waiting_ui',
            blocker: 'waiting_ui',
            turn: 'assistant',
            requiresUserTurn: false,
            summary: 'La interfaz parece estar cargando o procesando.',
            confidence: 0.7
        };
    }

    if (wantsUpload) {
        return {
            stage: 'navigating_to_upload',
            blocker: 'none',
            turn: 'assistant',
            requiresUserTurn: false,
            summary: 'Seguimos navegando de forma autónoma hacia la entrega o subida.',
            confidence: 0.65
        };
    }

    return {
        stage: 'navigating',
        blocker: 'none',
        turn: 'assistant',
        requiresUserTurn: false,
        summary: 'La interfaz no muestra un bloqueo explícito; el asistente debe seguir explorando.',
        confidence: 0.55
    };
}

module.exports = {
    detectBrowserExecutionState,
    normalizeText
};
