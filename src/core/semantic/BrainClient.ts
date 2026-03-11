/**
 * Brain Client
 * Coordinates the Semantic Brain flow:
 * Audio -> Transcription -> Intention (LLM) -> Options
 */

import { SemanticFormalizer, APP_REGISTRY } from './SemanticFormalizer';

export interface IntentionOption {
    id: string;
    label: string;      // "Check patient orders"
    appId: string;      // "medical-emr"
    confidence: number;
    action: string;     // Abstract action description
}

export class BrainClient {
    private deepgramKey: string;
    private formalizer: SemanticFormalizer;

    constructor() {
        this.deepgramKey = (import.meta as any).env.VITE_DEEPGRAM_API_KEY || '';
        this.formalizer = new SemanticFormalizer();

        if (!this.deepgramKey) {
            console.error('[BrainClient] Missing Deepgram API Key!');
        }
    }

    /**
     * PROCESS INTENTION
     * 1. Transcribe audio
     * 2. Consult LLM with context
     * 3. Return options
     */
    public async processIntention(audioBlob: Blob): Promise<IntentionOption[]> {
        console.log('[BrainClient] Processing intention...');

        // 1. Transcribe
        const transcript = await this.transcribeAudio(audioBlob);
        console.log(`[BrainClient] User said: "${transcript}"`);

        if (!transcript || transcript.trim().length < 2) {
            console.warn('[BrainClient] No speech detected');
            return [];
        }

        // 2. Get Context
        const context = this.formalizer.captureContext();
        const contextStr = this.formalizer.formatContextForPrompt(context);

        // 3. Mock LLM (since we don't have Anthropic Key yet)
        // In real implementation, this calls Claude API
        return await this.mockLLMProcessing(transcript, contextStr);
    }

    private async transcribeAudio(audioBlob: Blob): Promise<string> {
        try {
            console.log(`[BrainClient] Sending ${audioBlob.size} bytes to Deepgram...`);

            const response = await fetch('https://api.deepgram.com/v1/listen?smart_format=true&model=nova-2', {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${this.deepgramKey}`,
                    'Content-Type': 'audio/*',
                },
                body: audioBlob,
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Deepgram error: ${response.status} - ${error}`);
            }

            const data = await response.json();
            const transcript = data.results?.channels[0]?.alternatives[0]?.transcript || '';
            return transcript;

        } catch (error) {
            console.error('[BrainClient] Transcription failed:', error);
            return '';
        }
    }

    /**
     * Mock LLM for the "Intention Phase"
     * Returns plausible options based on keywords
     */
    private async mockLLMProcessing(transcript: string, context: string): Promise<IntentionOption[]> {
        console.log('[BrainClient] Consulted (Mock) LLM with context:', context);

        const text = transcript.toLowerCase();
        const options: IntentionOption[] = [];

        // Simple heuristic matching for POC
        APP_REGISTRY.forEach(app => {
            const matches = app.keywords.filter(k => text.includes(k));
            if (matches.length > 0) {
                options.push({
                    id: `opt-${app.id}-${Date.now()}`,
                    label: `Open ${app.name} to ${matches[0]}...`,
                    appId: app.id,
                    confidence: 0.9,
                    action: `User wants to ${matches[0]} in ${app.name}`
                });
            }
        });

        // Add a fallback option if list is empty or small
        if (options.length === 0) {
            options.push({
                id: 'opt-unknown',
                label: 'Search web for info',
                appId: 'browser',
                confidence: 0.5,
                action: 'General search'
            });
        }

        // Ensure we always have 3 options (fill with plausible variants)
        while (options.length < 3) {
            options.push({
                id: `opt-generic-${options.length}`,
                label: `General assistance (${options.length + 1})`,
                appId: 'assistant',
                confidence: 0.3,
                action: 'Help user'
            });
        }

        return options.slice(0, 3);
    }
}
