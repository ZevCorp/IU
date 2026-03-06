/**
 * MedEMR - Application Logic
 * Handles navigation, forms, and UI interactions
 */

// Current page detection
const currentPage = window.location.pathname.split('/').pop() || 'index.html';

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initForms();
    initTabs();
    initOrderTypes();
});

/**
 * Navigation handling
 */
function initNavigation() {
    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            // Demo validation
            if (username === 'dr.garcia' && password === 'demo123') {
                window.location.href = 'dashboard.html';
            } else {
                alert('Credenciales incorrectas. Use: dr.garcia / demo123');
            }
        });
    }

    // Logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            window.location.href = 'index.html';
        });
    }
}

/**
 * Form handling
 */
function initForms() {
    // Order form submission
    const orderForm = document.getElementById('orderForm');
    if (orderForm) {
        orderForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const patientSelect = document.getElementById('patientSelect');
            if (!patientSelect.value) {
                alert('Por favor seleccione un paciente');
                return;
            }

            // Simulate order creation
            alert('✅ Orden creada exitosamente');

            // Reset form
            document.getElementById('orderFormCard').style.display = 'none';
            document.getElementById('orderTypeCard').style.display = 'block';
            orderForm.reset();

            // Remove selected state from order types
            document.querySelectorAll('.order-type-btn').forEach(btn => {
                btn.classList.remove('selected');
            });
        });
    }

    // Cancel order button
    const cancelOrderBtn = document.getElementById('cancelOrderBtn');
    if (cancelOrderBtn) {
        cancelOrderBtn.addEventListener('click', () => {
            document.getElementById('orderFormCard').style.display = 'none';
            document.getElementById('orderTypeCard').style.display = 'block';
            document.querySelectorAll('.order-type-btn').forEach(btn => {
                btn.classList.remove('selected');
            });
        });
    }
}

/**
 * Tab navigation for patient detail
 */
function initTabs() {
    const tabs = document.querySelectorAll('.tab');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;

            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Show corresponding content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.style.display = 'none';
            });

            const targetContent = document.getElementById(`content-${targetTab}`);
            if (targetContent) {
                targetContent.style.display = 'block';
            }
        });
    });
}

/**
 * Order type selection
 */
function initOrderTypes() {
    const orderTypeBtns = document.querySelectorAll('.order-type-btn');

    orderTypeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const orderType = btn.dataset.type;

            // Update selection
            orderTypeBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');

            // Show form
            document.getElementById('orderTypeCard').style.display = 'none';
            document.getElementById('orderFormCard').style.display = 'block';

            // Update form title
            const titles = {
                lab: 'Nueva Orden de Laboratorio',
                imaging: 'Nueva Orden de Imagenología',
                medication: 'Nueva Orden de Medicamento'
            };
            document.getElementById('orderFormTitle').textContent = titles[orderType];

            // Show/hide relevant form groups
            document.getElementById('labTestsGroup').style.display = orderType === 'lab' ? 'block' : 'none';
            document.getElementById('imagingTypeGroup').style.display = orderType === 'imaging' ? 'block' : 'none';
            document.getElementById('medicationGroup').style.display = orderType === 'medication' ? 'block' : 'none';
        });
    });

    // New order button
    const newOrderBtn = document.getElementById('newOrderBtn');
    if (newOrderBtn) {
        newOrderBtn.addEventListener('click', () => {
            document.getElementById('orderTypeCard').style.display = 'block';
            document.getElementById('orderFormCard').style.display = 'none';
        });
    }
}

/**
 * Helper: Get current state for formalization
 * This will be used by Playwright to identify the current UI state
 */
function getUIState() {
    return {
        page: currentPage,
        activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
        orderFormVisible: document.getElementById('orderFormCard')?.style.display !== 'none',
        selectedOrderType: document.querySelector('.order-type-btn.selected')?.dataset.type || null,
        interactiveElements: getInteractiveElements()
    };
}

/**
 * Helper: Get all interactive elements for formalization
 */
function getInteractiveElements() {
    const selectors = 'button, a, input, select, textarea, [role="button"], .nav-item, .tab, .order-type-btn, tr[onclick]';
    const elements = document.querySelectorAll(selectors);

    return Array.from(elements).map(el => ({
        id: el.id || null,
        tag: el.tagName.toLowerCase(),
        type: el.type || el.getAttribute('role') || null,
        text: el.textContent?.trim().substring(0, 50) || null,
        selector: getUniqueSelector(el),
        visible: isVisible(el)
    })).filter(el => el.visible);
}

/**
 * Helper: Generate unique CSS selector for an element
 */
function getUniqueSelector(el) {
    if (el.id) return `#${el.id}`;

    if (el.className && typeof el.className === 'string') {
        const classes = el.className.split(' ').filter(c => c.length > 0).join('.');
        if (classes) {
            const selector = `${el.tagName.toLowerCase()}.${classes}`;
            if (document.querySelectorAll(selector).length === 1) {
                return selector;
            }
        }
    }

    // Fallback: use nth-child
    const parent = el.parentElement;
    if (parent) {
        const siblings = Array.from(parent.children);
        const index = siblings.indexOf(el) + 1;
        const parentSelector = getUniqueSelector(parent);
        return `${parentSelector} > ${el.tagName.toLowerCase()}:nth-child(${index})`;
    }

    return el.tagName.toLowerCase();
}

/**
 * Helper: Check if element is visible
 */
function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        el.offsetParent !== null;
}

// Expose for Playwright/external access
window.getUIState = getUIState;
window.getInteractiveElements = getInteractiveElements;
