/**
 * IÜ OS - Ü Face
 * Minimalist vector face with expressions
 */

class UFace {
    constructor(container) {
        this.container = container;
        this.state = 'idle'; // idle | thinking | happy | attention
        this.blinkInterval = null;
        this.breatheInterval = null;

        this.create();
    }

    create() {
        // Create SVG
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('viewBox', '0 0 100 100');
        this.svg.setAttribute('width', '100%');
        this.svg.setAttribute('height', '100%');
        this.svg.style.overflow = 'visible';

        this.svg.innerHTML = `
      <defs>
        <linearGradient id="faceGlow" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#00d4ff;stop-opacity:0.3" />
          <stop offset="100%" style="stop-color:#b042ff;stop-opacity:0.1" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      
      <!-- Face outline (subtle) -->
      <circle cx="50" cy="50" r="45" fill="none" stroke="url(#faceGlow)" stroke-width="0.5" opacity="0.3"/>
      
      <!-- Left eye -->
      <g id="left-eye" transform="translate(30, 40)">
        <ellipse id="left-eye-bg" cx="0" cy="0" rx="8" ry="10" fill="#0a0a0a"/>
        <ellipse id="left-eye-iris" cx="0" cy="0" rx="5" ry="6" fill="#00d4ff" filter="url(#glow)"/>
        <ellipse id="left-eye-pupil" cx="0" cy="0" rx="2" ry="3" fill="#000"/>
        <ellipse id="left-eye-highlight" cx="2" cy="-2" rx="1.5" ry="1" fill="#fff" opacity="0.8"/>
        <ellipse id="left-eyelid" cx="0" cy="-10" rx="9" ry="10" fill="#000" opacity="0"/>
      </g>
      
      <!-- Right eye -->
      <g id="right-eye" transform="translate(70, 40)">
        <ellipse id="right-eye-bg" cx="0" cy="0" rx="8" ry="10" fill="#0a0a0a"/>
        <ellipse id="right-eye-iris" cx="0" cy="0" rx="5" ry="6" fill="#00d4ff" filter="url(#glow)"/>
        <ellipse id="right-eye-pupil" cx="0" cy="0" rx="2" ry="3" fill="#000"/>
        <ellipse id="right-eye-highlight" cx="2" cy="-2" rx="1.5" ry="1" fill="#fff" opacity="0.8"/>
        <ellipse id="right-eyelid" cx="0" cy="-10" rx="9" ry="10" fill="#000" opacity="0"/>
      </g>
      
      <!-- Mouth -->
      <path id="mouth" d="M 35 65 Q 50 70 65 65" fill="none" stroke="#00d4ff" stroke-width="2" stroke-linecap="round" filter="url(#glow)"/>
    `;

        this.container.appendChild(this.svg);

        // Cache elements
        this.elements = {
            leftEye: {
                iris: this.svg.querySelector('#left-eye-iris'),
                pupil: this.svg.querySelector('#left-eye-pupil'),
                highlight: this.svg.querySelector('#left-eye-highlight'),
                eyelid: this.svg.querySelector('#left-eyelid'),
                group: this.svg.querySelector('#left-eye')
            },
            rightEye: {
                iris: this.svg.querySelector('#right-eye-iris'),
                pupil: this.svg.querySelector('#right-eye-pupil'),
                highlight: this.svg.querySelector('#right-eye-highlight'),
                eyelid: this.svg.querySelector('#right-eyelid'),
                group: this.svg.querySelector('#right-eye')
            },
            mouth: this.svg.querySelector('#mouth')
        };

        // Start ambient animations
        this.startAmbient();
    }

    startAmbient() {
        // Random blinking
        this.blinkInterval = setInterval(() => {
            if (Math.random() > 0.7) {
                this.blink();
            }
        }, 2000);

        // Subtle breathing (eye scale)
        this.breatheInterval = setInterval(() => {
            this.breathe();
        }, 50);
    }

    blink() {
        const duration = 150;

        // Close eyes
        this.animateEyelid(1, duration / 2);

        // Open eyes
        setTimeout(() => {
            this.animateEyelid(0, duration / 2);
        }, duration / 2);
    }

    animateEyelid(opacity, duration) {
        this.elements.leftEye.eyelid.style.transition = `opacity ${duration}ms ease`;
        this.elements.rightEye.eyelid.style.transition = `opacity ${duration}ms ease`;
        this.elements.leftEye.eyelid.style.opacity = opacity;
        this.elements.rightEye.eyelid.style.opacity = opacity;
    }

    breathe() {
        const t = Date.now() / 1000;
        const scale = 1 + Math.sin(t * 0.5) * 0.02;

        this.elements.leftEye.group.style.transform = `translate(30px, 40px) scale(${scale})`;
        this.elements.rightEye.group.style.transform = `translate(70px, 40px) scale(${scale})`;
    }

    /**
     * Look at a point (normalized 0-1)
     */
    lookAt(x, y) {
        const offsetX = (x - 0.5) * 3;
        const offsetY = (y - 0.5) * 2;

        // Move pupils
        this.elements.leftEye.pupil.setAttribute('cx', offsetX);
        this.elements.leftEye.pupil.setAttribute('cy', offsetY);
        this.elements.leftEye.highlight.setAttribute('cx', 2 + offsetX * 0.5);
        this.elements.leftEye.highlight.setAttribute('cy', -2 + offsetY * 0.5);

        this.elements.rightEye.pupil.setAttribute('cx', offsetX);
        this.elements.rightEye.pupil.setAttribute('cy', offsetY);
        this.elements.rightEye.highlight.setAttribute('cx', 2 + offsetX * 0.5);
        this.elements.rightEye.highlight.setAttribute('cy', -2 + offsetY * 0.5);
    }

    /**
     * Set expression
     */
    setExpression(expression) {
        this.state = expression;

        switch (expression) {
            case 'happy':
                this.elements.mouth.setAttribute('d', 'M 35 62 Q 50 75 65 62');
                this.setEyeColor('#00d4ff');
                break;

            case 'thinking':
                this.elements.mouth.setAttribute('d', 'M 40 65 Q 50 65 60 65');
                this.setEyeColor('#b042ff');
                // Squint slightly
                this.elements.leftEye.eyelid.style.opacity = 0.3;
                this.elements.rightEye.eyelid.style.opacity = 0.3;
                break;

            case 'attention':
                this.elements.mouth.setAttribute('d', 'M 35 65 Q 50 68 65 65');
                this.setEyeColor('#ff006e');
                // Widen eyes
                this.elements.leftEye.iris.setAttribute('ry', 7);
                this.elements.rightEye.iris.setAttribute('ry', 7);
                break;

            default: // idle
                this.elements.mouth.setAttribute('d', 'M 35 65 Q 50 70 65 65');
                this.setEyeColor('#00d4ff');
                this.elements.leftEye.eyelid.style.opacity = 0;
                this.elements.rightEye.eyelid.style.opacity = 0;
                this.elements.leftEye.iris.setAttribute('ry', 6);
                this.elements.rightEye.iris.setAttribute('ry', 6);
        }
    }

    setEyeColor(color) {
        this.elements.leftEye.iris.style.fill = color;
        this.elements.rightEye.iris.style.fill = color;
        this.elements.mouth.style.stroke = color;
    }

    destroy() {
        clearInterval(this.blinkInterval);
        clearInterval(this.breatheInterval);
        this.svg.remove();
    }
}

export default UFace;
