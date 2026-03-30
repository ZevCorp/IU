const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NotebookExecutionManager = require('../NotebookExecutionManager');
const KnowledgeService = require('../KnowledgeService');

function createKnowledgeFixture() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-knowledge-'));
    const notebookDir = path.join(rootDir, 'notebooks');
    const knowledgeDir = path.join(rootDir, 'knowledge');
    const now = (() => {
        let current = 1700000000000;
        return () => current++;
    })();

    const notebookManager = new NotebookExecutionManager({
        storageDir: notebookDir,
        isModelReady: () => false,
        now
    });
    notebookManager.bootstrap();

    const knowledgeService = new KnowledgeService({
        notebookManager,
        storageDir: knowledgeDir,
        now
    });

    return { knowledgeService, rootDir };
}

test('KnowledgeService bootstraps a fixed Finanzas meta and prevents deleting it', () => {
    const { knowledgeService } = createKnowledgeFixture();
    const metas = knowledgeService.bootstrap();
    const financeMeta = metas.find((meta) => meta.id === 'meta_finanzas');

    assert.ok(financeMeta);
    assert.equal(financeMeta.kind, 'finance');
    assert.equal(financeMeta.isFixed, true);
    assert.equal(financeMeta.title, 'Finanzas');
    assert.equal(knowledgeService.deleteMeta(financeMeta.id), false);
});

test('KnowledgeService updates finance instructions, pockets and projection while keeping Finanzas fixed', () => {
    const { knowledgeService } = createKnowledgeFixture();
    knowledgeService.bootstrap();

    const instructions = 'En Bancolombia va el dinero de gasto libre y debo priorizar cobros cuando la brecha futura baje.';
    const updatedMeta = knowledgeService.updateFinanceInstructions('meta_finanzas', instructions);
    assert.equal(updatedMeta.description, instructions);

    const withPocket = knowledgeService.createFinancePocket('meta_finanzas', {
        name: 'Bancolombia',
        bank: 'Bancolombia',
        purpose: 'Gasto libre',
        balance: 250000
    });
    assert.equal(withPocket.finance.pockets.length, 1);
    assert.equal(withPocket.finance.pockets[0].name, 'Bancolombia');

    const pocketId = withPocket.finance.pockets[0].id;
    const afterDeposit = knowledgeService.adjustFinancePocket('meta_finanzas', pocketId, 50000, 'deposit');
    assert.equal(afterDeposit.finance.pockets[0].balance, 300000);

    const afterProjection = knowledgeService.updateFinanceProjection('meta_finanzas', {
        expectedIncome: 900000,
        expectedExpenses: 350000,
        horizonWeeks: 3,
        currentLabel: 'Tiempo actual',
        futureLabel: 'Tiempo futuro'
    });

    assert.equal(afterProjection.finance.forecast.expectedIncome, 900000);
    assert.equal(afterProjection.finance.forecast.expectedExpenses, 350000);
    assert.equal(afterProjection.finance.forecast.horizonWeeks, 3);
    assert.equal(afterProjection.title, 'Finanzas');
    assert.equal(afterProjection.isFixed, true);
});
