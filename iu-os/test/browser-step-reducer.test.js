const test = require('node:test');
const assert = require('node:assert/strict');

const { reduceBrowserGoalProgress, shouldSkipRedundantBrowserAction } = require('../BrowserStepReducer');

test('marks menu as already open when downstream options are visible', () => {
    const progress = reduceBrowserGoalProgress({
        goal: 'Abrir esic.co y ve a estudiantes en el menu hamburguesa, luego ubeflex',
        url: 'https://esic.co/',
        elements: [
            { label: 'Menu', type: 'button' },
            { label: 'Estudiantes', type: 'button' },
            { label: 'UBEFLEX', type: 'link' }
        ]
    });

    assert.deepEqual(
        progress.completedSteps.map((step) => step.key),
        ['menu_open', 'students_visible']
    );
    assert.equal(progress.nextStep?.key, 'ubeflex_reached');
    assert.match(progress.guidanceText, /todavia no esta abierto/i);
    assert.match(progress.guidanceText, /NO por clics fijos/i);
});

test('recognizes that sharepoint ubeflex is already beyond initial menu navigation', () => {
    const progress = reduceBrowserGoalProgress({
        goal: 'Abre esic y entra a ubeflex',
        url: 'https://ceipaeduco.sharepoint.com/sites/ubflex-esic',
        elements: [
            { label: 'Business Intelligence', type: 'link' }
        ]
    });

    assert.equal(progress.states.alreadyBeyondInitialSteps, true);
    assert.equal(progress.completedSteps.some((step) => step.key === 'ubeflex_reached'), true);
});

test('skips hamburger click when menu state is already satisfied', () => {
    const progress = reduceBrowserGoalProgress({
        goal: 'Abre esic y entra a estudiantes',
        url: 'https://esic.co/',
        elements: [
            { label: 'Menu', type: 'button' },
            { label: 'Estudiantes', type: 'button' }
        ]
    });

    const decision = shouldSkipRedundantBrowserAction(
        { label: 'Menu hamburguesa', type: 'button' },
        progress
    );

    assert.equal(decision.skip, true);
    assert.equal(decision.reason, 'menu_already_open');
});

test('does not skip ubeflex click when ubeflex is only visible in the menu', () => {
    const progress = reduceBrowserGoalProgress({
        goal: 'Abre esic y entra a ubeflex',
        url: 'https://esic.co/',
        elements: [
            { label: 'Estudiantes', type: 'button' },
            { label: 'UBEFLEX', type: 'link' }
        ]
    });

    const decision = shouldSkipRedundantBrowserAction(
        { label: 'UBEFLEX', type: 'link' },
        progress
    );

    assert.equal(progress.states.ubeflexReached, false);
    assert.equal(decision.skip, false);
});

test('does not treat estudiantes as completed only because the parent item is visible', () => {
    const progress = reduceBrowserGoalProgress({
        goal: 'Abre esic y entra a estudiantes y luego ubeflex',
        url: 'https://esic.co/',
        elements: [
            { label: 'Menu', type: 'button' },
            { label: 'Estudiantes', type: 'button' }
        ]
    });

    assert.equal(progress.completedSteps.some((step) => step.key === 'menu_open'), true);
    assert.equal(progress.completedSteps.some((step) => step.key === 'students_visible'), false);
    assert.equal(progress.nextStep?.key, 'students_visible');
});
