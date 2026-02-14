/**
 * Compact Face Controller
 * Minimal face rendering for the compact circular window
 */

let face = null;

// Initialize face when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[Compact] Initializing face...');

    // Import Face class from face/index.js
    if (window.Face) {
        face = new window.Face('face-svg');
        await face.init();

        // Start with smile expression
        face.transitionTo('smile', 0);

        console.log('[Compact] Face initialized');
    } else {
        console.error('[Compact] Face class not available');
    }
});

// Listen for messages from main window to sync face state
if (window.iuOS) {
    window.iuOS.onActionStatus((data) => {
        const popup = document.getElementById('compact-popup');

        switch (data.status) {
            case 'executing':
                if (popup) {
                    popup.textContent = 'Ejecutando...';
                    popup.classList.add('visible');
                }
                if (face) face.transitionTo('looking_at_screen', 600);
                break;
            case 'complete':
                if (popup) {
                    popup.textContent = '✓ Listo';
                }
                if (face) face.transitionTo('smile', 800);
                setTimeout(() => {
                    if (popup) popup.classList.remove('visible');
                }, 2000);
                break;
            case 'error':
                if (popup) {
                    popup.textContent = '✗ Error';
                }
                if (face) face.transitionTo('neutral', 400);
                setTimeout(() => {
                    if (popup) popup.classList.remove('visible');
                }, 3000);
                break;
        }
    });
}
