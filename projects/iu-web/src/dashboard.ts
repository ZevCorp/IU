/* =====================================================
   I&Ü DASHBOARD - Logic
   ===================================================== */

interface Lead {
    email: string;
    message: string;
    devices: string[];
    date: string;
}

document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('login-btn');
    const loginScreen = document.getElementById('login-screen');
    const dashboardContent = document.getElementById('dashboard-content');
    const errorMsg = document.getElementById('login-error');

    // Verificar si ya está logueado (sesión activa)
    if (sessionStorage.getItem('iu_admin_auth') === 'true') {
        revealDashboard();
    }

    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            const user = (document.getElementById('username') as HTMLInputElement).value;
            const pass = (document.getElementById('password') as HTMLInputElement).value;

            // Credenciales solicitadas por Felipe
            if (user === 'FelipeMaldonado22' && pass === 'Tron202032$') {
                sessionStorage.setItem('iu_admin_auth', 'true');
                revealDashboard();
            } else {
                if (errorMsg) errorMsg.style.display = 'block';
            }
        });
    }

    function revealDashboard() {
        if (loginScreen) loginScreen.style.display = 'none';
        if (dashboardContent) dashboardContent.style.display = 'grid';
        renderDashboard();
    }

    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            alert('Función de exportación CSV preparada para integración con Backend.');
        });
    }
});

function renderDashboard() {
    const leadsJson = localStorage.getItem('iu_leads');
    const leads: Lead[] = leadsJson ? JSON.parse(leadsJson) : getMockLeads();

    // Stats
    const totalLeadsEl = document.getElementById('total-leads');
    const topDeviceEl = document.getElementById('top-device');

    if (totalLeadsEl) totalLeadsEl.innerText = leads.length.toString();

    // Top Device Calculation
    const deviceCounts: { [key: string]: number } = {};
    leads.forEach(lead => {
        lead.devices.forEach(d => {
            deviceCounts[d] = (deviceCounts[d] || 0) + 1;
        });
    });

    const sortedDevices = Object.entries(deviceCounts).sort((a, b) => b[1] - a[1]);
    if (topDeviceEl && sortedDevices.length > 0) {
        topDeviceEl.innerText = sortedDevices[0][0];
    }

    // Table
    const tbody = document.getElementById('leads-body');
    if (tbody) {
        tbody.innerHTML = leads.reverse().map(lead => `
            <tr>
                <td style="color: var(--text-gray); font-size: 0.8rem;">${new Date(lead.date).toLocaleDateString()}</td>
                <td style="font-weight: 500;">${lead.email}</td>
                <td>
                    <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                        ${lead.devices.map(d => `<span style="background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 4px; font-size: 0.7rem;">${d}</span>`).join('')}
                    </div>
                </td>
                <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-gray);">
                    ${lead.message || 'Sin mensaje'}
                </td>
                <td><span class="status-badge">Verificado</span></td>
            </tr>
        `).join('');
    }
}

function getMockLeads(): Lead[] {
    return [
        { email: 'laura.v@domain.com', message: 'Lo necesito para mi flujo de diseño', devices: ['MacOS', 'iPad'], date: '2026-03-01T10:00:00Z' },
        { email: 'carlos.m@tech.io', message: 'Interesado en control de domótica', devices: ['Android', 'Windows'], date: '2026-03-02T15:30:00Z' },
        { email: 'marta.r@gmail.com', message: 'Ayuda con productividad diaria', devices: ['iPhone', 'MacOS'], date: '2026-03-02T18:45:00Z' }
    ];
}
