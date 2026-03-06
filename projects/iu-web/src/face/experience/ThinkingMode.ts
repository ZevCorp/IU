/**
 * Thinking Mode Experience
 * Visualizes the AI's thought process:
 * 1. Shows "Thinking..." animation
 * 2. Receives Options from Brain
 * 3. Cycles through options every 8s
 * 4. Waits for Confirmation
 */

import { initializeFace } from '../../face/Face';
import { IntentionOption } from '../../core/semantic/BrainClient';
import { getFaceDetector } from '../../detection/FaceDetector';

export class ThinkingMode {
    private face: ReturnType<typeof initializeFace>;
    private options: IntentionOption[] = [];
    private currentIndex = 0;
    private cycleInterval: any = null;
    private isActive = false;

    // UI Elements
    private overlayEl: HTMLElement | null = null;
    private optionTextEl: HTMLElement | null = null;
    private confirmBtnEl: HTMLElement | null = null;

    constructor(face: ReturnType<typeof initializeFace>) {
        this.face = face;
        this.createUI();
    }

    private createUI() {
        // Create the overlay UI if not exists
        if (document.getElementById('thinking-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'thinking-overlay';
        overlay.className = 'thinking-overlay hidden';
        overlay.innerHTML = `
            <div class="thinking-content">
                <div class="thinking-loader"></div>
                <h2 id="thinking-text" class="thinking-text">...</h2>
                <button id="thinking-confirm" class="thinking-confirm-btn">
                    <span class="btn-icon">👁️</span> CONFIRM ACTION
                </button>
            </div>
            <style>
                .thinking-overlay {
                    position: fixed;
                    top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0,0,0,0.8);
                    z-index: 9999;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: opacity 0.5s;
                    backdrop-filter: blur(5px);
                }
                .thinking-overlay.hidden {
                    opacity: 0;
                    pointer-events: none;
                }
                .thinking-content {
                    text-align: center;
                    color: white;
                    max-width: 80%;
                }
                .thinking-text {
                    font-family: 'Inter', sans-serif;
                    font-size: 2rem;
                    margin: 20px 0;
                    font-weight: 300;
                    opacity: 0;
                    transform: translateY(20px);
                    transition: all 0.5s;
                }
                .thinking-text.visible {
                    opacity: 1;
                    transform: translateY(0);
                }
                .thinking-confirm-btn {
                    background: rgba(255, 255, 255, 0.1);
                    border: 1px solid rgba(255, 255, 255, 0.3);
                    color: white;
                    padding: 15px 40px;
                    border-radius: 30px;
                    font-size: 1.2rem;
                    cursor: pointer;
                    transition: all 0.3s;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                }
                .thinking-confirm-btn:hover {
                    background: white;
                    color: black;
                    transform: scale(1.05);
                }
            </style>
        `;
        document.body.appendChild(overlay);

        this.overlayEl = overlay;
        this.optionTextEl = document.getElementById('thinking-text');
        this.confirmBtnEl = document.getElementById('thinking-confirm');

        this.confirmBtnEl?.addEventListener('click', () => {
            this.confirmSelection();
        });
    }

    public startThinking() {
        this.isActive = true;
        this.face.transitionTo('thinking', 0.5);

        if (this.overlayEl) {
            this.overlayEl.classList.remove('hidden');
        }

        this.showText('Listening & Processing...');
    }

    public presentOptions(options: IntentionOption[]) {
        if (!this.isActive) return;

        this.options = options;
        this.currentIndex = 0;

        // Start cycling
        this.showCurrentOption();

        if (this.cycleInterval) clearInterval(this.cycleInterval);
        this.cycleInterval = setInterval(() => {
            this.cycleNext();
        }, 8000); // 8 seconds per option
    }

    private cycleNext() {
        if (this.options.length === 0) return;
        this.currentIndex = (this.currentIndex + 1) % this.options.length;
        this.showCurrentOption();
    }

    private showCurrentOption() {
        if (this.options.length === 0) return;
        const opt = this.options[this.currentIndex];

        // Animate text out
        this.optionTextEl?.classList.remove('visible');

        setTimeout(() => {
            if (this.optionTextEl) {
                this.optionTextEl.innerText = `"${opt.label}"`;
                this.optionTextEl.classList.add('visible');
            }
        }, 500);
    }

    private showText(text: string) {
        if (this.optionTextEl) {
            this.optionTextEl.innerText = text;
            this.optionTextEl.classList.add('visible');
        }
    }

    public confirmSelection() {
        if (!this.isActive || this.options.length === 0) return;

        const selected = this.options[this.currentIndex];
        console.log('[ThinkingMode] CONFIRMED:', selected);

        this.stop();

        // Execute Action (Navigation / App Switch)
        // For POC, we just alert
        alert(`CONFIRMED: ${selected.label}\nApp: ${selected.appId}`);

        // Here we would call the App Router / Executor
        if (selected.appId === 'medical-emr') {
            window.open('https://iü.space/medical/', '_blank');
        }

        this.face.transitionTo('smile', 0.5);
    }

    public stop() {
        this.isActive = false;
        if (this.cycleInterval) clearInterval(this.cycleInterval);

        this.face.transitionTo('neutral', 0.5);

        if (this.overlayEl) {
            this.overlayEl.classList.add('hidden');
        }
    }
}
