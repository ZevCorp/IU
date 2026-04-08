import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { CUSTOM_GPT_ACTIONS, CUSTOM_GPT_SYSTEM_PROMPT, buildCustomGptOpenApi } = require('../iu-os/CustomGptConfig.js');

const SUPABASE_URL = String(process.env.IU_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.IU_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_PUBLISHABLE_KEY = String(
    process.env.IU_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
).trim();

const GPT_PUBLIC_API_BASE_URL = String(
    process.env.IU_GPT_PUBLIC_API_BASE_URL ||
    process.env.IU_GPT_RENDER_API_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ''
).trim().replace(/\/$/, '');
const GPT_LOGIN_PAGE_URL = String(
    process.env.IU_GPT_LOGIN_PAGE_URL ||
    'https://iu-1.onrender.com/oauth.html'
).trim();
const GPT_OAUTH_CLIENT_ID = String(process.env.IU_GPT_OAUTH_CLIENT_ID || '').trim();
const GPT_OAUTH_CLIENT_SECRET = String(process.env.IU_GPT_OAUTH_CLIENT_SECRET || '').trim();

const OAUTH_REQUEST_TTL_MS = Math.max(60_000, Number(process.env.IU_GPT_OAUTH_REQUEST_TTL_MS || 10 * 60_000));
const OAUTH_CODE_TTL_MS = Math.max(30_000, Number(process.env.IU_GPT_OAUTH_CODE_TTL_MS || 5 * 60_000));
const ACCESS_TOKEN_TTL_MS = Math.max(60_000, Number(process.env.IU_GPT_ACCESS_TOKEN_TTL_MS || 30 * 24 * 60 * 60 * 1000));
const ACTION_TIMEOUT_MS = Math.max(5_000, Math.min(60_000, Number(process.env.IU_GPT_ACTION_TIMEOUT_MS || 25_000)));
const ACTION_POLL_MS = Math.max(250, Number(process.env.IU_GPT_ACTION_POLL_MS || 1_500));

function gptCorsHeaders(extra = {}) {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        ...extra
    };
}

function json(res, status, payload) {
    res.writeHead(status, gptCorsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
    res.end(JSON.stringify(payload, null, 2));
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
    res.writeHead(status, gptCorsHeaders({ 'Content-Type': contentType }));
    res.end(body);
}

function redirect(res, location) {
    res.writeHead(302, {
        ...gptCorsHeaders(),
        Location: location
    });
    res.end();
}

function isConfigured() {
    return Boolean(
        SUPABASE_URL &&
        SUPABASE_SERVICE_ROLE_KEY &&
        SUPABASE_PUBLISHABLE_KEY &&
        GPT_OAUTH_CLIENT_ID &&
        GPT_OAUTH_CLIENT_SECRET
    );
}

function getPublicBaseUrl(req) {
    if (GPT_PUBLIC_API_BASE_URL) {
        return GPT_PUBLIC_API_BASE_URL.replace(/\/$/, '');
    }
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host || 'localhost';
    return `${proto}://${host}`;
}

function normalizeOpenAiRedirectUri(raw = '') {
    const value = String(raw || '').trim();
    if (!value) return '';
    try {
        const url = new URL(value);
        const validHost = url.hostname === 'chat.openai.com' || url.hostname === 'chatgpt.com';
        const validPath = /^\/aip\/g-[A-Za-z0-9]+\/oauth\/callback$/.test(url.pathname);
        if (!validHost || !validPath) return '';
        return `${url.origin}${url.pathname}`;
    } catch (_) {
        return '';
    }
}

function parseBasicAuth(header = '') {
    const value = String(header || '').trim();
    if (!value.toLowerCase().startsWith('basic ')) return { clientId: '', clientSecret: '' };
    try {
        const decoded = Buffer.from(value.slice(6), 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator === -1) return { clientId: '', clientSecret: '' };
        return {
            clientId: decoded.slice(0, separator),
            clientSecret: decoded.slice(separator + 1)
        };
    } catch (_) {
        return { clientId: '', clientSecret: '' };
    }
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function sha256Base64Url(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('base64url');
}

function randomToken(size = 32) {
    return crypto.randomBytes(size).toString('base64url');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
}

async function readJsonBody(req) {
    const raw = await readBody(req);
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch (_) {
        return {};
    }
}

async function readFormBody(req) {
    const raw = await readBody(req);
    return new URLSearchParams(raw);
}

async function supabaseRest(path, options = {}) {
    const method = options.method || 'GET';
    const headers = {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...(options.headers || {})
    };

    const response = await fetch(`${SUPABASE_URL}${path}`, {
        method,
        headers,
        body: options.body
    });

    const textBody = await response.text();
    const payload = textBody ? (() => {
        try {
            return JSON.parse(textBody);
        } catch (_) {
            return textBody;
        }
    })() : null;

    if (!response.ok) {
        const message = typeof payload === 'object' && payload?.message
            ? payload.message
            : (typeof payload === 'string' ? payload : `Supabase request failed (${response.status})`);
        const error = new Error(message);
        error.status = response.status;
        error.payload = payload;
        throw error;
    }

    return payload;
}

async function getSupabaseUser(accessToken) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${accessToken}`
        }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.id) {
        return null;
    }
    return payload;
}

async function createOauthRequest({ clientId, redirectUri, state, scope, codeChallenge, codeChallengeMethod, metadata = {} }) {
    const payload = await supabaseRest('/rest/v1/custom_gpt_oauth_requests', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
        },
        body: JSON.stringify([{
            client_id: clientId,
            redirect_uri: redirectUri,
            state: state || null,
            scope: scope || '',
            code_challenge: codeChallenge || null,
            code_challenge_method: codeChallengeMethod || null,
            metadata,
            expires_at: new Date(Date.now() + OAUTH_REQUEST_TTL_MS).toISOString()
        }])
    });
    return Array.isArray(payload) ? payload[0] : null;
}

async function getOauthRequest(requestId) {
    const query = new URLSearchParams({
        select: 'id, client_id, redirect_uri, state, scope, code_challenge, code_challenge_method, user_id, approved_at, denied_at, expires_at'
    });
    const payload = await supabaseRest(`/rest/v1/custom_gpt_oauth_requests?id=eq.${encodeURIComponent(requestId)}&${query.toString()}`);
    return Array.isArray(payload) ? payload[0] || null : null;
}

async function markOauthRequestApproved(requestId, userId) {
    await supabaseRest(`/rest/v1/custom_gpt_oauth_requests?id=eq.${encodeURIComponent(requestId)}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            user_id: userId,
            approved_at: new Date().toISOString(),
            denied_at: null
        })
    });
}

async function markOauthRequestDenied(requestId) {
    await supabaseRest(`/rest/v1/custom_gpt_oauth_requests?id=eq.${encodeURIComponent(requestId)}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            denied_at: new Date().toISOString()
        })
    });
}

async function createOauthCode({ requestId, userId, clientId, redirectUri, scope, codeChallenge, codeChallengeMethod }) {
    const code = randomToken(32);
    const payload = await supabaseRest('/rest/v1/custom_gpt_oauth_codes', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
        },
        body: JSON.stringify([{
            request_id: requestId,
            user_id: userId,
            client_id: clientId,
            redirect_uri: redirectUri,
            scope: scope || '',
            code_hash: sha256Hex(code),
            code_challenge: codeChallenge || null,
            code_challenge_method: codeChallengeMethod || null,
            expires_at: new Date(Date.now() + OAUTH_CODE_TTL_MS).toISOString()
        }])
    });
    return {
        code,
        row: Array.isArray(payload) ? payload[0] || null : null
    };
}

async function getOauthCodeRow(code) {
    const query = new URLSearchParams({
        select: 'id, user_id, client_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at, consumed_at'
    });
    const payload = await supabaseRest(`/rest/v1/custom_gpt_oauth_codes?code_hash=eq.${sha256Hex(code)}&${query.toString()}`);
    return Array.isArray(payload) ? payload[0] || null : null;
}

async function consumeOauthCode(codeId) {
    await supabaseRest(`/rest/v1/custom_gpt_oauth_codes?id=eq.${encodeURIComponent(codeId)}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            consumed_at: new Date().toISOString()
        })
    });
}

async function createAccessToken({ userId, clientId, scope }) {
    const token = randomToken(48);
    const payload = await supabaseRest('/rest/v1/custom_gpt_oauth_access_tokens', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
        },
        body: JSON.stringify([{
            user_id: userId,
            client_id: clientId,
            scope: scope || '',
            token_hash: sha256Hex(token),
            expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString()
        }])
    });
    return {
        token,
        row: Array.isArray(payload) ? payload[0] || null : null
    };
}

async function getAccessTokenRow(token) {
    const query = new URLSearchParams({
        select: 'id, user_id, client_id, scope, expires_at'
    });
    const payload = await supabaseRest(`/rest/v1/custom_gpt_oauth_access_tokens?token_hash=eq.${sha256Hex(token)}&${query.toString()}`);
    return Array.isArray(payload) ? payload[0] || null : null;
}

async function touchAccessToken(id) {
    await supabaseRest(`/rest/v1/custom_gpt_oauth_access_tokens?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            last_used_at: new Date().toISOString()
        })
    });
}

function buildAuthorizeErrorRedirect(redirectUri, error, state, description) {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    if (description) {
        url.searchParams.set('error_description', description);
    }
    if (state) {
        url.searchParams.set('state', state);
    }
    return url.toString();
}

function normalizeScope(raw) {
    return String(raw || '').trim().split(/\s+/).filter(Boolean).join(' ');
}

function normalizeClientCredentials(bodyParams, req) {
    const basic = parseBasicAuth(req.headers.authorization || '');
    const bodyClientId = String(bodyParams.get('client_id') || '').trim();
    const bodyClientSecret = String(bodyParams.get('client_secret') || '').trim();
    return {
        clientId: basic.clientId || bodyClientId,
        clientSecret: basic.clientSecret || bodyClientSecret
    };
}

async function enqueueActionForUser(userId, operationName, requestPayload) {
    const query = new URLSearchParams({
        select: 'id',
        user_id: `eq.${userId}`,
        is_default: 'eq.true',
        session_status: 'eq.active',
        session_expires_at: `gt.${new Date().toISOString()}`,
        limit: '1'
    });
    const desktops = await supabaseRest(`/rest/v1/custom_gpt_desktops?${query.toString()}`);
    const desktop = Array.isArray(desktops) ? desktops[0] || null : null;
    if (!desktop?.id) {
        return { ok: false, status: 404, error: 'No active desktop voice session for this user' };
    }

    const inserted = await supabaseRest('/rest/v1/custom_gpt_action_requests', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
        },
        body: JSON.stringify([{
            user_id: userId,
            desktop_id: desktop.id,
            operation_name: operationName,
            request_payload: requestPayload || {},
            status: 'queued',
            expires_at: new Date(Date.now() + ACTION_TIMEOUT_MS + 10_000).toISOString()
        }])
    });

    const requestRow = Array.isArray(inserted) ? inserted[0] || null : null;
    if (!requestRow?.id) {
        return { ok: false, status: 500, error: 'Could not enqueue action' };
    }

    const deadline = Date.now() + ACTION_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const lookup = await supabaseRest(`/rest/v1/custom_gpt_action_requests?id=eq.${encodeURIComponent(requestRow.id)}&select=status,response_payload,error_text`);
        const current = Array.isArray(lookup) ? lookup[0] || null : null;

        if (current?.status === 'completed') {
            return { ok: true, status: 200, payload: current.response_payload || { ok: true } };
        }

        if (current?.status === 'failed') {
            return {
                ok: false,
                status: 200,
                payload: current.response_payload || { ok: false, error: current.error_text || 'Desktop execution failed' }
            };
        }

        await sleep(ACTION_POLL_MS);
    }

    await supabaseRest(`/rest/v1/custom_gpt_action_requests?id=eq.${encodeURIComponent(requestRow.id)}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            status: 'timed_out',
            error_text: 'Timed out waiting for desktop response',
            completed_at: new Date().toISOString()
        })
    });

    return {
        ok: false,
        status: 504,
        payload: { ok: false, error: 'Timed out waiting for desktop response' }
    };
}

async function handleAuthorize(req, res, requestUrl) {
    const responseType = String(requestUrl.searchParams.get('response_type') || '').trim();
    const clientId = String(requestUrl.searchParams.get('client_id') || '').trim();
    const redirectUri = normalizeOpenAiRedirectUri(requestUrl.searchParams.get('redirect_uri') || '');
    const scope = normalizeScope(requestUrl.searchParams.get('scope') || '');
    const state = String(requestUrl.searchParams.get('state') || '').trim();
    const codeChallenge = String(requestUrl.searchParams.get('code_challenge') || '').trim();
    const codeChallengeMethod = String(requestUrl.searchParams.get('code_challenge_method') || '').trim().toUpperCase();

    if (!isConfigured()) {
        return text(res, 500, 'Custom GPT OAuth server is not configured.');
    }

    if (!redirectUri) {
        return text(res, 400, 'invalid redirect_uri');
    }

    if (responseType !== 'code') {
        return redirect(res, buildAuthorizeErrorRedirect(redirectUri, 'unsupported_response_type', state, 'response_type must be code'));
    }

    if (!safeEqual(clientId, GPT_OAUTH_CLIENT_ID)) {
        return redirect(res, buildAuthorizeErrorRedirect(redirectUri, 'unauthorized_client', state, 'client_id is invalid'));
    }

    if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
        return redirect(res, buildAuthorizeErrorRedirect(redirectUri, 'invalid_request', state, 'code_challenge_method must be S256'));
    }

    const requestRow = await createOauthRequest({
        clientId,
        redirectUri,
        state,
        scope,
        codeChallenge,
        codeChallengeMethod: codeChallengeMethod || null,
        metadata: {
            user_agent: req.headers['user-agent'] || '',
            requested_host: req.headers.host || ''
        }
    });

    if (!requestRow?.id) {
        return text(res, 500, 'could not create oauth request');
    }

    const redirectUrl = new URL(GPT_LOGIN_PAGE_URL);
    redirectUrl.searchParams.set('request_id', requestRow.id);
    return redirect(res, redirectUrl.toString());
}

async function handleRequestDetails(res, requestUrl) {
    const requestId = String(requestUrl.searchParams.get('request_id') || '').trim();
    if (!requestId) {
        return json(res, 400, { ok: false, error: 'request_id is required' });
    }

    const requestRow = await getOauthRequest(requestId);
    if (!requestRow) {
        return json(res, 404, { ok: false, error: 'OAuth request not found' });
    }

    if (new Date(requestRow.expires_at).getTime() <= Date.now()) {
        return json(res, 410, { ok: false, error: 'OAuth request expired' });
    }

    return json(res, 200, {
        ok: true,
        request: {
            id: requestRow.id,
            client_name: 'Ü OS',
            scope: requestRow.scope || '',
            scopes: normalizeScope(requestRow.scope || '').split(' ').filter(Boolean)
        }
    });
}

async function handleApprove(req, res) {
    const body = await readJsonBody(req);
    const requestId = String(body.request_id || '').trim();
    const authHeader = String(req.headers.authorization || '').trim();
    const accessToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';

    if (!requestId || !accessToken) {
        return json(res, 400, { ok: false, error: 'request_id and user authorization are required' });
    }

    const requestRow = await getOauthRequest(requestId);
    if (!requestRow) {
        return json(res, 404, { ok: false, error: 'OAuth request not found' });
    }
    if (new Date(requestRow.expires_at).getTime() <= Date.now()) {
        return json(res, 410, { ok: false, error: 'OAuth request expired' });
    }

    const user = await getSupabaseUser(accessToken);
    if (!user?.id) {
        return json(res, 401, { ok: false, error: 'Supabase session invalid' });
    }

    await markOauthRequestApproved(requestId, user.id);
    const { code } = await createOauthCode({
        requestId,
        userId: user.id,
        clientId: requestRow.client_id,
        redirectUri: requestRow.redirect_uri,
        scope: requestRow.scope || '',
        codeChallenge: requestRow.code_challenge || '',
        codeChallengeMethod: requestRow.code_challenge_method || ''
    });

    const redirectUrl = new URL(requestRow.redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (requestRow.state) {
        redirectUrl.searchParams.set('state', requestRow.state);
    }

    return json(res, 200, {
        ok: true,
        redirect_to: redirectUrl.toString()
    });
}

async function handleDeny(req, res) {
    const body = await readJsonBody(req);
    const requestId = String(body.request_id || '').trim();

    if (!requestId) {
        return json(res, 400, { ok: false, error: 'request_id is required' });
    }

    const requestRow = await getOauthRequest(requestId);
    if (!requestRow) {
        return json(res, 404, { ok: false, error: 'OAuth request not found' });
    }

    await markOauthRequestDenied(requestId);
    return json(res, 200, {
        ok: true,
        redirect_to: buildAuthorizeErrorRedirect(requestRow.redirect_uri, 'access_denied', requestRow.state, 'User denied access')
    });
}

async function handleToken(req, res) {
    const bodyParams = await readFormBody(req);
    const grantType = String(bodyParams.get('grant_type') || '').trim();
    const redirectUri = normalizeOpenAiRedirectUri(bodyParams.get('redirect_uri') || '');
    const { clientId, clientSecret } = normalizeClientCredentials(bodyParams, req);

    if (!safeEqual(clientId, GPT_OAUTH_CLIENT_ID) || !safeEqual(clientSecret, GPT_OAUTH_CLIENT_SECRET)) {
        return json(res, 401, { error: 'invalid_client' });
    }

    if (grantType !== 'authorization_code') {
        return json(res, 400, { error: 'unsupported_grant_type' });
    }

    const code = String(bodyParams.get('code') || '').trim();
    const codeVerifier = String(bodyParams.get('code_verifier') || '').trim();

    if (!code || !redirectUri) {
        return json(res, 400, { error: 'invalid_request' });
    }

    const codeRow = await getOauthCodeRow(code);
    if (!codeRow) {
        return json(res, 400, { error: 'invalid_grant' });
    }
    if (codeRow.consumed_at || new Date(codeRow.expires_at).getTime() <= Date.now()) {
        return json(res, 400, { error: 'invalid_grant' });
    }
    if (!safeEqual(codeRow.client_id, clientId) || !safeEqual(codeRow.redirect_uri, redirectUri)) {
        return json(res, 400, { error: 'invalid_grant' });
    }
    if (codeRow.code_challenge) {
        if (!codeVerifier) {
            return json(res, 400, { error: 'invalid_request' });
        }
        const expectedChallenge = codeRow.code_challenge_method === 'S256'
            ? sha256Base64Url(codeVerifier)
            : codeVerifier;
        if (!safeEqual(expectedChallenge, codeRow.code_challenge)) {
            return json(res, 400, { error: 'invalid_grant' });
        }
    }

    await consumeOauthCode(codeRow.id);
    const { token } = await createAccessToken({
        userId: codeRow.user_id,
        clientId,
        scope: codeRow.scope || ''
    });

    return json(res, 200, {
        access_token: token,
        token_type: 'bearer',
        expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
        scope: codeRow.scope || ''
    });
}

async function handleAction(req, res, operationName) {
    const authHeader = String(req.headers.authorization || '').trim();
    const accessToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';

    if (!accessToken) {
        return json(res, 401, { ok: false, error: 'Missing bearer token' });
    }

    const operation = CUSTOM_GPT_ACTIONS.find((item) => item.name === operationName);
    if (!operation) {
        return json(res, 404, { ok: false, error: `Unknown operation: ${operationName}` });
    }

    const tokenRow = await getAccessTokenRow(accessToken);
    if (!tokenRow || new Date(tokenRow.expires_at).getTime() <= Date.now()) {
        return json(res, 401, { ok: false, error: 'Invalid or expired access token' });
    }

    await touchAccessToken(tokenRow.id).catch(() => { });
    const requestPayload = await readJsonBody(req);
    const result = await enqueueActionForUser(tokenRow.user_id, operation.name, requestPayload);

    if (result.ok) {
        return json(res, result.status || 200, result.payload);
    }

    return json(res, result.status || 500, result.payload || { ok: false, error: result.error || 'Action failed' });
}

function handleOpenApi(req, res) {
    const baseUrl = `${getPublicBaseUrl(req)}/gpt`;
    const openApi = buildCustomGptOpenApi({
        baseUrl,
        pathPrefix: '/action',
        title: 'IU OS Custom GPT Actions',
        description: 'OAuth + actions bridge publico para el GPT personalizado de IU OS.'
    });
    return json(res, 200, openApi);
}

function handleSystemPrompt(res) {
    return json(res, 200, { ok: true, prompt: CUSTOM_GPT_SYSTEM_PROMPT });
}

function handleHealth(res) {
    return json(res, 200, {
        ok: true,
        transport: 'render-oauth-supabase-desktop-relay',
        operations: CUSTOM_GPT_ACTIONS.map((operation) => operation.name),
        loginPageUrl: GPT_LOGIN_PAGE_URL
    });
}

export async function handleCustomGptHttp(req, res) {
    if (!req.url.startsWith('/gpt')) {
        return false;
    }

    if (req.method === 'OPTIONS') {
        res.writeHead(204, gptCorsHeaders());
        res.end();
        return true;
    }

    const requestUrl = new URL(req.url, getPublicBaseUrl(req));
    const pathname = requestUrl.pathname;

    try {
        if (req.method === 'GET' && pathname === '/gpt/health') {
            handleHealth(res);
            return true;
        }

        if (req.method === 'GET' && pathname === '/gpt/openapi.json') {
            handleOpenApi(req, res);
            return true;
        }

        if (req.method === 'GET' && pathname === '/gpt/system-prompt') {
            handleSystemPrompt(res);
            return true;
        }

        if (req.method === 'GET' && pathname === '/gpt/oauth/authorize') {
            await handleAuthorize(req, res, requestUrl);
            return true;
        }

        if (req.method === 'GET' && pathname === '/gpt/oauth/request') {
            await handleRequestDetails(res, requestUrl);
            return true;
        }

        if (req.method === 'POST' && pathname === '/gpt/oauth/approve') {
            await handleApprove(req, res);
            return true;
        }

        if (req.method === 'POST' && pathname === '/gpt/oauth/deny') {
            await handleDeny(req, res);
            return true;
        }

        if (req.method === 'POST' && pathname === '/gpt/oauth/token') {
            await handleToken(req, res);
            return true;
        }

        if (req.method === 'POST' && pathname.startsWith('/gpt/action/')) {
            const operationName = pathname.replace('/gpt/action/', '').trim();
            await handleAction(req, res, operationName);
            return true;
        }

        json(res, 404, { ok: false, error: 'Not found' });
        return true;
    } catch (error) {
        console.error('[CustomGPT]', error);
        json(res, 500, {
            ok: false,
            error: error?.message || 'Unexpected server error'
        });
        return true;
    }
}
