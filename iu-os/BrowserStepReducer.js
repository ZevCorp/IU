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

function createStep(key, label, completed) {
    return { key, label, completed: !!completed };
}

function reduceBrowserGoalProgress(input = {}) {
    const goalText = normalizeText(`${input.goal || ''} ${input.stepsHint || ''}`);
    const urlText = normalizeText(input.url || '');
    const elementsText = collectSignals(input.elements);
    const signalText = `${urlText} ${elementsText}`.trim();

    const menuPatterns = ['menu', 'hamburguesa', 'menu principal', 'abrir menu', 'open menu'];
    const studentsPatterns = ['estudiantes', 'student'];
    const ubeflexPatterns = ['ubeflex', 'ubflex', 'ube flex'];
    const canvasPatterns = ['canvas'];
    const uploadPatterns = ['subir', 'upload', 'adjuntar', 'archivo', 'entrega', 'trabajo'];
    const filePickerPatterns = ['seleccionar archivo', 'adjuntar archivo', 'choose file', 'browse', 'examinar'];

    const menuVisible = includesAny(signalText, menuPatterns);
    const studentsVisible = includesAny(signalText, studentsPatterns);
    const ubeflexVisible = includesAny(signalText, ubeflexPatterns);
    const sharepointVisible = includesAny(signalText, ['sharepoint', 'ceipaeduco sharepoint com', 'sites ubflex esic']);
    const canvasVisible = includesAny(signalText, canvasPatterns);
    const ubeflexReached = sharepointVisible || canvasVisible || (
        includesAny(urlText, ['sharepoint', 'sites ubflex esic']) &&
        !includesAny(urlText, ['esic co'])
    );
    const uploadVisible = includesAny(signalText, filePickerPatterns) || (
        includesAny(signalText, uploadPatterns) &&
        includesAny(signalText, ['titulo', 'descripcion', 'seleccionar archivo', 'adjuntar archivo'])
    );
    const loginVisible = includesAny(signalText, [
        'iniciar sesion',
        'login',
        'sign in',
        'password',
        'contrasena',
        'correo',
        'email',
        'microsoftonline',
        'oauth',
        'saml'
    ]);

    const wantsMenuPath = includesAny(goalText, [...menuPatterns, ...studentsPatterns, ...ubeflexPatterns]);
    const wantsStudents = includesAny(goalText, studentsPatterns);
    const wantsUbeflex = includesAny(goalText, ubeflexPatterns);
    const wantsCanvas = includesAny(goalText, canvasPatterns);
    const wantsUpload = includesAny(goalText, uploadPatterns);

    const steps = [];
    if (wantsMenuPath) {
        steps.push(createStep(
            'menu_open',
            'El menu de navegacion ya esta desplegado',
            studentsVisible || ubeflexVisible || sharepointVisible || canvasVisible
        ));
    }
    if (wantsStudents) {
        steps.push(createStep(
            'students_visible',
            'La seccion Estudiantes ya fue expandida o superada',
            ubeflexVisible || ubeflexReached || sharepointVisible || canvasVisible
        ));
    }
    if (wantsUbeflex) {
        steps.push(createStep(
            'ubeflex_reached',
            'Ubeflex ya esta realmente abierto',
            ubeflexReached
        ));
    }
    if (wantsCanvas) {
        steps.push(createStep(
            'canvas_reached',
            'Canvas ya esta visible',
            canvasVisible
        ));
    }
    if (wantsUpload) {
        steps.push(createStep(
            'upload_area_reached',
            'La zona de subida o entrega ya es visible',
            uploadVisible
        ));
    }

    const completedSteps = steps.filter((step) => step.completed);
    const pendingSteps = steps.filter((step) => !step.completed);
    const nextStep = pendingSteps[0] || null;
    const alreadyBeyondInitialSteps = sharepointVisible || canvasVisible;

    const guidanceLines = [];
    if (completedSteps.length > 0) {
        guidanceLines.push(`PASOS YA CUMPLIDOS EN LA UI: ${completedSteps.map((step) => step.key).join(', ')}`);
    }
    if (nextStep) {
        guidanceLines.push(`SIGUIENTE HITO REAL A CUMPLIR: ${nextStep.key}`);
    }
    if (ubeflexVisible && !ubeflexReached) {
        guidanceLines.push('UBEFLEX ESTA VISIBLE COMO OPCION DE MENU, PERO TODAVIA NO ESTA ABIERTO.');
    }
    if (alreadyBeyondInitialSteps) {
        guidanceLines.push('YA ESTAS EN UNA ETAPA POSTERIOR; NO REGRESES A PASOS INICIALES COMO ABRIR MENU O ENTRAR DE NUEVO A UBEFLEX.');
    }
    if (loginVisible) {
        guidanceLines.push('SE DETECTA LOGIN O AUTENTICACION EN LA UI ACTUAL.');
    }

    return {
        steps,
        completedSteps,
        pendingSteps,
        nextStep,
        states: {
            menuVisible,
            studentsVisible,
            ubeflexVisible,
            ubeflexReached,
            sharepointVisible,
            canvasVisible,
            uploadVisible,
            loginVisible,
            alreadyBeyondInitialSteps
        },
        guidanceText: guidanceLines.length > 0
            ? `\n\nPROGRESO REAL DE LA INTERFAZ:\n- ${guidanceLines.join('\n- ')}\n- Actua por hitos pendientes, NO por clics fijos del plan original.`
            : ''
    };
}

function shouldSkipRedundantBrowserAction(element, progress) {
    if (!element || !progress) return { skip: false, reason: '' };

    const label = normalizeText(`${element?.label || ''} ${element?.text || ''}`);
    const role = normalizeText(element?.role || element?.type || '');
    const completed = new Set((progress.completedSteps || []).map((step) => step.key));
    const states = progress.states || {};

    if (completed.has('menu_open') && includesAny(label, ['menu', 'hamburguesa']) && !states.loginVisible) {
        return { skip: true, reason: 'menu_already_open' };
    }
    if (completed.has('students_visible') && includesAny(label, ['estudiantes'])) {
        return { skip: true, reason: 'students_step_already_visible' };
    }
    if (completed.has('ubeflex_reached') && includesAny(label, ['ubeflex', 'ubflex', 'ube flex'])) {
        return { skip: true, reason: 'ubeflex_already_reached' };
    }
    if (completed.has('canvas_reached') && includesAny(label, ['canvas'])) {
        return { skip: true, reason: 'canvas_already_reached' };
    }
    if (states.alreadyBeyondInitialSteps && includesAny(label, ['menu', 'hamburguesa', 'estudiantes', 'ubeflex', 'ubflex']) && ['button', 'link'].includes(role)) {
        return { skip: true, reason: 'already_beyond_initial_navigation' };
    }

    return { skip: false, reason: '' };
}

module.exports = {
    reduceBrowserGoalProgress,
    shouldSkipRedundantBrowserAction,
    normalizeText
};
