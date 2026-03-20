const test = require('node:test');
const assert = require('node:assert/strict');

const { detectBrowserExecutionState } = require('../BrowserExecutionState');

test('detects login handoff before asking for future upload data', () => {
    const result = detectBrowserExecutionState({
        goal: 'Subir un trabajo en esic',
        elements: [
            { label: 'Usuario', type: 'textbox' },
            { label: 'Password', type: 'textbox' },
            { label: 'Iniciar sesion', type: 'button' },
            { label: 'Titulo', type: 'textbox' }
        ]
    });

    assert.equal(result.stage, 'login_required');
    assert.equal(result.turn, 'user');
    assert.match(result.userMessage, /inicies sesi.n/i);
});

test('detects explicit file selection handoff', () => {
    const result = detectBrowserExecutionState({
        goal: 'Subir el trabajo final',
        elements: [
            { label: 'Seleccionar archivo', type: 'button' },
            { label: 'Adjuntar archivo', type: 'button' }
        ]
    });

    assert.equal(result.stage, 'file_required');
    assert.equal(result.turn, 'user');
    assert.match(result.userMessage, /archivo/i);
});

test('detects metadata handoff only once upload form is visible', () => {
    const result = detectBrowserExecutionState({
        goal: 'Subir un trabajo',
        elements: [
            { label: 'Titulo', type: 'textbox' },
            { label: 'Descripcion', type: 'textbox' },
            { label: 'Asignatura', type: 'textbox' },
            { label: 'Profesor', type: 'textbox' }
        ]
    });

    assert.equal(result.stage, 'metadata_required');
    assert.equal(result.turn, 'user');
});

test('stays autonomous while still navigating', () => {
    const result = detectBrowserExecutionState({
        goal: 'Subir un trabajo',
        elements: [
            { label: 'Menu', type: 'button' },
            { label: 'Estudiantes', type: 'button' },
            { label: 'Ubeflex', type: 'link' }
        ]
    });

    assert.equal(result.stage, 'navigating_to_upload');
    assert.equal(result.turn, 'assistant');
    assert.equal(result.requiresUserTurn, false);
});

test('does not trigger login handoff only because the plan mentions login', () => {
    const result = detectBrowserExecutionState({
        goal: 'Subir un trabajo',
        stepsHint: 'Ir a esic, iniciar sesión si hace falta y luego subir el trabajo',
        url: 'https://esic.co/',
        elements: [
            { label: 'Menu', type: 'button' },
            { label: 'Estudiantes', type: 'button' },
            { label: 'Ubeflex', type: 'link' }
        ]
    });

    assert.equal(result.stage, 'navigating_to_upload');
    assert.equal(result.turn, 'assistant');
});
