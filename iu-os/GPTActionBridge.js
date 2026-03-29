const http = require('http');
const { URL } = require('url');

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            if (chunks.length === 0) {
                resolve({});
                return;
            }
            try {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve(text.trim() ? JSON.parse(text) : {});
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

function json(res, statusCode, payload) {
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

class GPTActionBridge {
    constructor(options = {}) {
        this.host = String(options.host || '127.0.0.1').trim() || '127.0.0.1';
        this.port = Number(options.port || 4318);
        this.authToken = String(options.authToken || '').trim();
        this.publicBaseUrl = String(options.publicBaseUrl || '').trim();
        this.operations = new Map();
        this.server = null;
        this.startedPort = null;

        const entries = Array.isArray(options.operations) ? options.operations : [];
        for (const entry of entries) {
            if (!entry?.name || typeof entry.handler !== 'function') continue;
            this.operations.set(String(entry.name).trim(), entry);
        }
    }

    async start() {
        if (this.server) {
            return { ok: true, port: this.startedPort || this.port };
        }

        this.server = http.createServer(async (req, res) => {
            try {
                await this._handleRequest(req, res);
            } catch (error) {
                json(res, 500, {
                    ok: false,
                    error: error?.message || 'Bridge internal error'
                });
            }
        });

        await new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(this.port, this.host, () => {
                this.startedPort = this.server.address()?.port || this.port;
                resolve();
            });
        });

        return {
            ok: true,
            host: this.host,
            port: this.startedPort
        };
    }

    async stop() {
        if (!this.server) return { ok: true, stopped: false };
        const server = this.server;
        this.server = null;
        this.startedPort = null;
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) reject(error);
                else resolve();
            });
        });
        return { ok: true, stopped: true };
    }

    getOpenApiUrl() {
        const baseUrl = this.publicBaseUrl || `http://${this.host}:${this.startedPort || this.port}`;
        return `${baseUrl.replace(/\/$/, '')}/openapi.json`;
    }

    async _handleRequest(req, res) {
        const method = String(req.method || 'GET').toUpperCase();
        const url = new URL(req.url || '/', `http://${this.host}:${this.startedPort || this.port}`);
        const pathname = url.pathname;

        if (!this._isAuthorized(req)) {
            json(res, 401, {
                ok: false,
                error: 'Unauthorized'
            });
            return;
        }

        if (method === 'GET' && pathname === '/health') {
            json(res, 200, {
                ok: true,
                service: 'gpt_action_bridge',
                operations: Array.from(this.operations.keys())
            });
            return;
        }

        if (method === 'GET' && pathname === '/openapi.json') {
            json(res, 200, this._buildOpenApiSpec());
            return;
        }

        if (method === 'POST' && pathname.startsWith('/v1/tools/')) {
            const operationName = pathname.slice('/v1/tools/'.length).trim();
            const operation = this.operations.get(operationName);
            if (!operation) {
                json(res, 404, {
                    ok: false,
                    error: `Unknown operation: ${operationName}`
                });
                return;
            }

            let body = {};
            try {
                body = await readJsonBody(req);
            } catch (error) {
                json(res, 400, {
                    ok: false,
                    error: 'Invalid JSON body'
                });
                return;
            }

            const result = await operation.handler(body, {
                method,
                pathname,
                query: Object.fromEntries(url.searchParams.entries())
            });
            json(res, 200, result === undefined ? { ok: true } : result);
            return;
        }

        json(res, 404, {
            ok: false,
            error: 'Not found'
        });
    }

    _isAuthorized(req) {
        if (!this.authToken) return true;
        const header = String(req.headers.authorization || '').trim();
        return header === `Bearer ${this.authToken}`;
    }

    _buildOpenApiSpec() {
        const baseUrl = this.publicBaseUrl || `http://${this.host}:${this.startedPort || this.port}`;
        const paths = {};

        for (const [name, operation] of this.operations.entries()) {
            paths[`/v1/tools/${name}`] = {
                post: {
                    operationId: name,
                    summary: operation.summary || name,
                    description: operation.description || '',
                    requestBody: {
                        required: false,
                        content: {
                            'application/json': {
                                schema: operation.inputSchema || {
                                    type: 'object',
                                    additionalProperties: true
                                }
                            }
                        }
                    },
                    responses: {
                        200: {
                            description: 'Successful response',
                            content: {
                                'application/json': {
                                    schema: operation.outputSchema || {
                                        type: 'object',
                                        additionalProperties: true
                                    }
                                }
                            }
                        }
                    }
                }
            };
        }

        return {
            openapi: '3.1.0',
            info: {
                title: 'IU OS GPT Action Bridge',
                version: '1.0.0',
                description: 'Backend actions for the custom ChatGPT voice assistant.'
            },
            servers: [
                { url: baseUrl.replace(/\/$/, '') }
            ],
            paths
        };
    }
}

module.exports = GPTActionBridge;
