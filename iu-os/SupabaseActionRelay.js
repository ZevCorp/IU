class SupabaseActionRelay {
    constructor(options = {}) {
        this.supabaseUrl = String(options.supabaseUrl || '').trim();
        this.supabaseKey = String(options.supabaseKey || '').trim();
        this.functionBaseUrl = String(options.functionBaseUrl || '').trim()
            || (this.supabaseUrl ? `${this.supabaseUrl.replace(/\/$/, '')}/functions/v1/custom-gpt-relay` : '');
        this.desktopId = String(options.desktopId || '').trim();
        this.desktopSecret = String(options.desktopSecret || '').trim();
        this.deviceId = String(options.deviceId || '').trim();
        this.customGptUrl = String(options.customGptUrl || '').trim();
        this.logger = options.logger || console;
        this.onExecute = typeof options.onExecute === 'function'
            ? options.onExecute
            : (async () => ({ ok: false, error: 'No execute handler configured' }));
        this.waitTimeoutMs = Math.max(5000, Number(options.waitTimeoutMs || 30000));

        this.sessionId = '';
        this.started = false;
        this.pollLoopPromise = null;
        this.stopRequested = false;
    }

    isConfigured() {
        return Boolean(
            this.supabaseUrl &&
            this.supabaseKey &&
            this.functionBaseUrl &&
            this.desktopId &&
            this.desktopSecret
        );
    }

    async start() {
        if (this.started) {
            return { ok: true, started: false, session_id: this.sessionId || null };
        }

        if (!this.isConfigured()) {
            return {
                ok: false,
                skipped: true,
                error: 'Supabase action relay not configured'
            };
        }

        const opened = await this.invoke('/desktop/session/open', {
            desktop_id: this.desktopId,
            desktop_secret: this.desktopSecret,
            device_id: this.deviceId || undefined,
            custom_gpt_url: this.customGptUrl || undefined
        });

        if (!opened?.ok || !opened?.session_id) {
            return {
                ok: false,
                error: opened?.error || 'Could not open desktop session'
            };
        }

        this.sessionId = String(opened.session_id || '').trim();
        this.started = true;
        this.stopRequested = false;
        this.pollLoopPromise = this.runPollLoop();
        this.logger.log(`🔌 [SupabaseRelay] Voice session open ${this.sessionId}`);

        return {
            ok: true,
            started: true,
            session_id: this.sessionId
        };
    }

    async stop() {
        this.stopRequested = true;
        const activeSessionId = this.sessionId;

        if (this.pollLoopPromise) {
            try {
                await this.pollLoopPromise;
            } catch (_) {
                // ignore poll loop termination errors
            }
        }

        this.pollLoopPromise = null;
        this.started = false;
        this.sessionId = '';

        if (activeSessionId) {
            try {
                await this.invoke('/desktop/session/close', {
                    desktop_id: this.desktopId,
                    desktop_secret: this.desktopSecret,
                    session_id: activeSessionId
                });
            } catch (error) {
                this.logger.warn('⚠️ [SupabaseRelay] Could not close desktop session:', error?.message || error);
            }
        }

        return { ok: true };
    }

    async runPollLoop() {
        while (!this.stopRequested && this.started && this.sessionId) {
            try {
                const payload = await this.invoke('/desktop/wait-next', {
                    desktop_id: this.desktopId,
                    desktop_secret: this.desktopSecret,
                    session_id: this.sessionId,
                    timeout_ms: this.waitTimeoutMs
                });

                if (!payload?.ok) {
                    this.logger.warn('⚠️ [SupabaseRelay] wait-next returned error:', payload?.error || 'unknown');
                    await this.pause(1200);
                    continue;
                }

                if (payload.timeout || !payload.request) {
                    continue;
                }

                await this.processRequest(payload.request);
            } catch (error) {
                if (!this.stopRequested) {
                    this.logger.warn('⚠️ [SupabaseRelay] Poll loop error:', error?.message || error);
                    await this.pause(1500);
                }
            }
        }
    }

    async processRequest(request = {}) {
        const requestId = String(request.id || '').trim();
        const operationName = String(request.operation_name || '').trim();
        const body = request.request_payload && typeof request.request_payload === 'object'
            ? request.request_payload
            : {};

        if (!requestId || !operationName) {
            return;
        }

        let result = null;
        try {
            result = await this.onExecute(operationName, body, {
                requestId,
                source: 'supabase_custom_gpt'
            });
        } catch (error) {
            result = {
                ok: false,
                error: error?.message || 'Desktop execution failed'
            };
        }

        try {
            await this.invoke('/desktop/complete', {
                desktop_id: this.desktopId,
                desktop_secret: this.desktopSecret,
                session_id: this.sessionId,
                request_id: requestId,
                result
            });
        } catch (error) {
            this.logger.error('❌ [SupabaseRelay] Could not complete request:', error?.message || error);
        }
    }

    async invoke(pathname, body = {}) {
        const response = await fetch(`${this.functionBaseUrl}${pathname}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: this.supabaseKey
            },
            body: JSON.stringify(body)
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error || `Supabase relay call failed (${response.status})`);
        }
        return payload;
    }

    pause(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

module.exports = SupabaseActionRelay;
