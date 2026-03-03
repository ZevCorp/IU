/* =====================================================
   I&Ü LANDING PAGE - Logic
   ===================================================== */

document.addEventListener('DOMContentLoaded', () => {
    initCountdown();
    initFaceAnimation();
    initWaitlist();
    initReadingMode();

    console.log('🌟 I&Ü Landing Page Ready');
});

/**
 * Precise Scroll-Driven Reading Mode
 */
function initReadingMode() {
    window.addEventListener('scroll', () => {
        const scroll = window.scrollY;
        const windowHeight = window.innerHeight;
        const totalHeight = document.documentElement.scrollHeight;

        // --- TRANSICIÓN INICIAL (FADE OUT VIDEO) ---
        const fadeStart = 100;
        const fadeEnd = 500;
        let startProgress = (scroll - fadeStart) / (fadeEnd - fadeStart);
        startProgress = Math.max(0, Math.min(1, startProgress));

        // --- TRANSICIÓN FINAL (FADE IN VIDEO) ---
        const scrollBottom = totalHeight - windowHeight;
        const bottomFadeZone = 600; // Distancia desde el fondo para empezar a mostrar el video
        let bottomProgress = (scrollBottom - scroll) / bottomFadeZone;
        bottomProgress = Math.max(0, Math.min(1, bottomProgress));

        // El progreso final es 1 solo si estamos fuera del inicio Y lejos del final
        const finalProgress = startProgress * bottomProgress;

        // Sincronizamos la variable CSS con el progreso del scroll
        document.body.style.setProperty('--read-progress', finalProgress.toString());
    });
}

/**
 * Initialize Countdown Timer to next Tuesday
 */
function initCountdown() {
    const targetDate = new Date('March 5, 2026 17:05:00').getTime();

    function update() {
        const now = new Date().getTime();
        const distance = targetDate - now;

        // Time calculations
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        // Update elements
        const dEl = document.getElementById('days');
        const hEl = document.getElementById('hours');
        const mEl = document.getElementById('minutes');
        const sEl = document.getElementById('seconds');

        if (dEl) dEl.innerText = String(days < 10 ? '0' + days : days);
        if (hEl) hEl.innerText = String(hours < 10 ? '0' + hours : hours);
        if (mEl) mEl.innerText = String(minutes < 10 ? '0' + minutes : minutes);
        if (sEl) sEl.innerText = String(seconds < 10 ? '0' + seconds : seconds);

        if (distance < 0) {
            clearInterval(timer);
            const container = document.querySelector('.countdown-container');
            if (container) {
                container.innerHTML = "<span>Lanzamiento iniciado.</span>";
            }
        }
    }

    const timer = setInterval(update, 1000);
    update();
}

/**
 * Subtle Face Animations (Ü)
 */
function initFaceAnimation() {
    const mouth = document.getElementById('mouth');
    const leftEye = document.querySelector('#left-eye path') as SVGPathElement | null;
    const rightEye = document.querySelector('#right-eye path') as SVGPathElement | null;

    // Add subtle organic movement
    let time = 0;
    function animate() {
        time += 0.05;

        // Subtle mouth movement (talking/breathing)
        if (mouth) {
            const yOffset = Math.sin(time * 0.5) * 5;
            mouth.setAttribute('d', `M -30 ${40 + yOffset} Q 0 ${60 + yOffset} 30 ${40 + yOffset}`);
        }

        // Random blinking
        if (Math.random() < 0.01) {
            blink(leftEye, rightEye);
        }

        requestAnimationFrame(animate);
    }

    function blink(l: SVGPathElement | null, r: SVGPathElement | null) {
        if (!l || !r) return;
        const originalD = l.getAttribute('d');
        if (!originalD) return;

        l.setAttribute('d', 'M -60 -20 Q -40 -20 -20 -20');
        r.setAttribute('d', 'M 20 -20 Q 40 -20 60 -20');

        setTimeout(() => {
            l.setAttribute('d', originalD);
            r.setAttribute('d', originalD.replace(/-60/g, '20').replace(/-40/g, '40').replace(/-20/g, '60'));
        }, 150);
    }

    animate();
}

/**
 * Waitlist Form and Modal Logic
 */
function initWaitlist() {
    const form = document.getElementById('waitlist-form') as HTMLFormElement;
    const initialBtn = document.getElementById('join-btn') as HTMLButtonElement;
    const emailInput = document.getElementById('email-input') as HTMLInputElement;

    const modal = document.getElementById('form-modal') as HTMLElement;
    const closeModal = document.getElementById('close-modal') as HTMLButtonElement;
    const finalBtn = document.getElementById('final-submit') as HTMLButtonElement;
    const helpText = document.getElementById('help-text') as HTMLTextAreaElement;

    let userEmail = "";

    if (form && modal) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (emailInput.checkValidity()) {
                userEmail = emailInput.value;
                modal.classList.add('active');
            }
        });

        // Close modal
        if (closeModal) {
            closeModal.addEventListener('click', () => {
                modal.classList.remove('active');
            });
        }

        // Final Submit
        if (finalBtn) {
            finalBtn.addEventListener('click', () => {
                const devices = Array.from(document.querySelectorAll('input[name="device"]:checked'))
                    .map(el => (el as HTMLInputElement).value);

                const message = helpText ? helpText.value : "";

                const newLead = {
                    email: userEmail,
                    message: message,
                    devices: devices,
                    date: new Date().toISOString()
                };

                // Persistencia local (Simulación de DB para Dashboard)
                const leads = JSON.parse(localStorage.getItem('iu_leads') || '[]');
                leads.push(newLead);
                localStorage.setItem('iu_leads', JSON.stringify(leads));

                console.log('Lead Guardado:', newLead);

                // --- INTEGRACIÓN REAL CON RESEND ---
                // Usamos variable de entorno para seguridad en el despliegue
                const RESEND_API_KEY = import.meta.env.VITE_RESEND_API_KEY || 're_7xTitwSw_Q9DgxY8gEVBhvdE2vwf87YvD';

                const htmlContent = `
                    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 40px; background-color: #ffffff; color: #000000; border-radius: 24px; border: 1px solid #eaeaea;">
                        <h1 style="font-family: 'Outfit', sans-serif; font-weight: 300; font-size: 32px; margin-bottom: 24px; letter-spacing: -1px;">Hola Ü!</h1>
                        <p style="font-size: 16px; line-height: 1.6; color: #333333; margin-bottom: 32px;">
                            Serás parte de los primeros usuarios en probar <strong>IÜ</strong> una vez te enviemos el instalador, tus opiniones y feedback serán lo más valioso para nuestro camino de aquí en adelante. Gracias por querer revolucionar el mundo con nosotros.
                        </p>
                        <hr style="border: 0; border-top: 1px solid #eaeaea; margin-bottom: 32px;">
                        <p style="font-size: 14px; color: #666666; margin: 0;">Atentamente,</p>
                        <p style="font-size: 18px; font-weight: 600; margin: 4px 0 0 0;">Felipe Maldonado</p>
                    </div>
                `;

                fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${RESEND_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        from: 'IÜ <onboarding@resend.dev>', // Usar dominio verificado en prod
                        to: [userEmail],
                        subject: 'Bienvenido a IÜ - Tu instalador está en camino',
                        html: htmlContent
                    })
                }).then(r => r.json()).then(data => console.log('Resend Response:', data))
                    .catch(e => console.error('Resend Error:', e));

                // Success state visual
                finalBtn.textContent = '¡Bienvenido a bordo!';
                finalBtn.disabled = true;
                finalBtn.style.background = '#4ade80';
                finalBtn.style.color = '#fff';

                setTimeout(() => {
                    modal.classList.remove('active');

                    // Update main UI
                    initialBtn.textContent = '¡Todo listo!';
                    initialBtn.disabled = true;
                    initialBtn.style.background = '#ffffff';
                    initialBtn.style.color = '#000000';

                    emailInput.value = 'Revisa tu bandeja de entrada.';
                    emailInput.disabled = true;
                }, 1500);
            });
        }
    }
}
