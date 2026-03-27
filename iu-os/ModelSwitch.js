/**
 * ModelSwitch.js
 * Selecciona el modelo principal con BRAIN_MODEL y deriva el provider automáticamente.
 *
 * Uso:
 *   const { chatCompletion, visionCompletion, getProviderSummary } = require('./ModelSwitch');
 *   // Ambas funciones tienen la misma interfaz de entrada/salida.
 */

// ============================================================
// 🔀 SWITCH: Seleccion por modelo (provider automatico)
//    BRAIN_MODEL: nombre explicito del modelo (ej: "nemotron-3-super")
//    BRAIN_CHAT_PROVIDER / BRAIN_VISION_PROVIDER: override opcional por compatibilidad
// ============================================================
const DEFAULT_BRAIN_MODEL = 'nemotron-3-super';

const LEGACY_MODEL_ALIASES = {
    nano: 'gpt-5-mini',
    mini: 'gpt-5-mini',
    full: 'gpt-5.2',
    haiku: 'claude-haiku-4-5-20251001'
};

const MODEL_CATALOG = {
    'nemotron-3-super': {
        displayName: 'Nemotron 3 Super',
        provider: 'openrouter',
        chat: 'nvidia/nemotron-3-super-120b-a12b',
        vision: null
    },
    'gpt-5-mini': {
        displayName: 'GPT-5 Mini',
        provider: 'openai',
        chat: 'gpt-5-mini',
        vision: 'gpt-5-mini'
    },
    'gpt-5.2': {
        displayName: 'GPT-5.2',
        provider: 'openai',
        chat: 'gpt-5.2',
        vision: 'gpt-5.2'
    },
    'gemini-2.5-flash': {
        displayName: 'Gemini 2.5 Flash',
        provider: 'gemini',
        chat: 'gemini-2.5-flash',
        vision: 'gemini-2.5-flash'
    },
    'claude-haiku-4-5-20251001': {
        displayName: 'Claude Haiku 4.5',
        provider: 'anthropic',
        chat: 'claude-haiku-4-5-20251001',
        vision: 'claude-haiku-4-5-20251001'
    },
    'claude-sonnet-4-6': {
        displayName: 'Claude Sonnet 4.6',
        provider: 'anthropic',
        chat: 'claude-sonnet-4-6',
        vision: 'claude-sonnet-4-6'
    },
    'mercury-2': {
        displayName: 'Inception Mercury 2',
        provider: 'inception',
        chat: 'mercury-2',
        vision: null
    },
    mercury: {
        displayName: 'Inception Mercury',
        provider: 'inception',
        chat: 'mercury',
        vision: null
    }
};

function _normalizeModelSelection(rawModel) {
    const normalized = String(rawModel || '').trim().toLowerCase();
    if (!normalized) return DEFAULT_BRAIN_MODEL;
    return LEGACY_MODEL_ALIASES[normalized] || normalized;
}

function _inferProviderFromModel(modelId) {
    if (modelId.startsWith('gpt-')) return 'openai';
    if (modelId.startsWith('gemini-')) return 'gemini';
    if (modelId.startsWith('claude-')) return 'anthropic';
    if (modelId.startsWith('mercury')) return 'inception';
    if (modelId.includes('/')) return 'openrouter';
    return 'openai';
}

function _supportsVisionProvider(provider) {
    return provider === 'openai' || provider === 'gemini' || provider === 'anthropic';
}

function _resolveSelectedModel() {
    const requested = _normalizeModelSelection(process.env.BRAIN_MODEL);
    const catalogEntry = MODEL_CATALOG[requested];
    if (catalogEntry) {
        return {
            key: requested,
            displayName: catalogEntry.displayName,
            provider: catalogEntry.provider,
            chat: catalogEntry.chat,
            vision: catalogEntry.vision
        };
    }

    const provider = _inferProviderFromModel(requested);
    return {
        key: requested,
        displayName: requested,
        provider,
        chat: requested,
        vision: _supportsVisionProvider(provider) ? requested : null
    };
}

const SELECTED_MODEL = _resolveSelectedModel();

// Clients — se inicializan desde main.js
let _openai = null;
let _gemini = null;
let _anthropic = null;
let _inception = null;
let _openrouter = null;
let _lastLoggedOpenAIModel = '';
let _lastLoggedInceptionModel = '';
let _lastLoggedOpenRouterModel = '';
let _warnedVisionFallback = false;
let _warnedOpenRouterRequiredToolChoice = false;

function initOpenAI(openaiClient) {
    _openai = openaiClient;
}

function initGemini(apiKey) {
    if (!apiKey) return;
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    _gemini = new GoogleGenerativeAI(apiKey);
    console.log('✅ Gemini initialized (ModelSwitch)');
}

function initAnthropic(apiKey) {
    if (!apiKey) return;
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropic = new Anthropic({ apiKey });
    console.log('✅ Anthropic initialized (ModelSwitch)');
}

function initInception(apiKey, options = {}) {
    if (!apiKey) return;
    const OpenAI = require('openai');
    const baseURL = options.baseURL || process.env.INCEPTION_BASE_URL || 'https://api.inceptionlabs.ai/v1';
    _inception = new OpenAI({ apiKey, baseURL });
    console.log(`✅ Inception initialized (ModelSwitch) via ${options.source || 'runtime'} @ ${baseURL}`);
}

function initOpenRouter(openrouterClient, options = {}) {
    if (!openrouterClient) return;
    _openrouter = openrouterClient;
    console.log(`✅ OpenRouter initialized (ModelSwitch) via ${options.source || 'runtime'} @ ${options.baseURL || 'https://openrouter.ai/api/v1'}`);
}

// ============================================================
// Modelos por provider
// ============================================================
const MODELS = {
    selected: SELECTED_MODEL,
    openai: {
        chat: process.env.OPENAI_MODEL || (SELECTED_MODEL.provider === 'openai' ? SELECTED_MODEL.chat : 'gpt-5-mini'),
        vision: process.env.OPENAI_MODEL || (SELECTED_MODEL.provider === 'openai' && SELECTED_MODEL.vision ? SELECTED_MODEL.vision : 'gpt-5-mini')
    },
    gemini: {
        chat: process.env.GEMINI_MODEL || (SELECTED_MODEL.provider === 'gemini' ? SELECTED_MODEL.chat : 'gemini-2.5-flash'),
        vision: process.env.GEMINI_MODEL || (SELECTED_MODEL.provider === 'gemini' && SELECTED_MODEL.vision ? SELECTED_MODEL.vision : 'gemini-2.5-flash')
    },
    anthropic: {
        chat: process.env.ANTHROPIC_MODEL || (SELECTED_MODEL.provider === 'anthropic' ? SELECTED_MODEL.chat : 'claude-haiku-4-5-20251001'),
        vision: process.env.ANTHROPIC_MODEL || (SELECTED_MODEL.provider === 'anthropic' && SELECTED_MODEL.vision ? SELECTED_MODEL.vision : 'claude-haiku-4-5-20251001')
    },
    inception: {
        chat: process.env.INCEPTION_MODEL || (SELECTED_MODEL.provider === 'inception' ? SELECTED_MODEL.chat : 'mercury'),
        vision: null
    },
    openrouter: {
        chat: process.env.OPENROUTER_MODEL || (SELECTED_MODEL.provider === 'openrouter' ? SELECTED_MODEL.chat : MODEL_CATALOG['nemotron-3-super'].chat),
        vision: null
    }
};

function _fallbackVisionProvider(currentProvider) {
    if (currentProvider !== 'openai' && _openai) return 'openai';
    if (currentProvider !== 'gemini' && _gemini) return 'gemini';
    if (currentProvider !== 'anthropic' && _anthropic) return 'anthropic';
    if (currentProvider !== 'openrouter' && _openrouter && MODELS.openrouter.vision) return 'openrouter';
    return currentProvider;
}

function getChatProvider() {
    if (process.env.BRAIN_CHAT_PROVIDER) {
        return String(process.env.BRAIN_CHAT_PROVIDER).trim();
    }

    // Compatibilidad legacy: si no hay modelo explicito, permite BRAIN_PROVIDER
    if (!process.env.BRAIN_MODEL && process.env.BRAIN_PROVIDER) {
        return String(process.env.BRAIN_PROVIDER).trim();
    }

    return SELECTED_MODEL.provider;
}

function getVisionProvider() {
    if (process.env.BRAIN_VISION_PROVIDER) {
        return String(process.env.BRAIN_VISION_PROVIDER).trim();
    }

    // Compatibilidad legacy: si no hay modelo explicito, permite BRAIN_PROVIDER
    if (!process.env.BRAIN_MODEL && process.env.BRAIN_PROVIDER) {
        return String(process.env.BRAIN_PROVIDER).trim();
    }

    const modelProvider = SELECTED_MODEL.provider;
    if (SELECTED_MODEL.vision) return modelProvider;

    if (!_warnedVisionFallback) {
        console.warn(`⚠️ [ModelSwitch] ${SELECTED_MODEL.displayName} no tiene ruta de vision en este runtime. Usando fallback visual disponible.`);
        _warnedVisionFallback = true;
    }
    return _fallbackVisionProvider(modelProvider);
}

function getProviderSummary() {
    return {
        selectedModel: MODELS.selected,
        chatProvider: getChatProvider(),
        visionProvider: getVisionProvider(),
        models: MODELS
    };
}

function _resolveClient(provider) {
    if (provider === 'openai') return _openai;
    if (provider === 'gemini') return _gemini;
    if (provider === 'anthropic') return _anthropic;
    if (provider === 'inception') return _inception;
    if (provider === 'openrouter') return _openrouter;
    return null;
}

function _resolveFallbackChatProvider(excludeProvider = '') {
    const order = ['openai', 'gemini', 'anthropic', 'inception'];
    for (const provider of order) {
        if (provider === excludeProvider) continue;
        if (_resolveClient(provider)) return provider;
    }
    return null;
}

// ============================================================
// chatCompletion — texto puro con function calling
// Interfaz unificada: { messages, tools, tool_choice, max_tokens }
// Retorna: formato OpenAI-compatible { choices: [{ message: { content, tool_calls } }] }
// ============================================================
async function chatCompletion({ messages, tools, tool_choice, max_tokens, model, provider }) {
    const selectedProvider = provider || getChatProvider();
    if (selectedProvider === 'openai') {
        return _chatOpenAI({ messages, tools, tool_choice, max_tokens, model });
    } else if (selectedProvider === 'anthropic') {
        return _chatAnthropic({ messages, tools, tool_choice, max_tokens, model });
    } else if (selectedProvider === 'inception') {
        return _chatInception({ messages, tools, tool_choice, max_tokens, model });
    } else if (selectedProvider === 'openrouter') {
        try {
            return await _chatOpenRouter({ messages, tools, tool_choice, max_tokens, model });
        } catch (error) {
            const hasTools = Array.isArray(tools) && tools.length > 0;
            if (hasTools && _isOpenRouterToolCallingFailure(error)) {
                const fallbackProvider = _resolveFallbackChatProvider('openrouter');
                if (fallbackProvider) {
                    console.warn(`⚠️ [ModelSwitch] OpenRouter no devolvió tool_calls de forma confiable. Fallback a ${fallbackProvider}.`);
                    return await chatCompletion({
                        messages,
                        tools,
                        tool_choice,
                        max_tokens,
                        model,
                        provider: fallbackProvider
                    });
                }
            }
            throw error;
        }
    } else {
        return _chatGemini({ messages, tools, tool_choice, max_tokens, model });
    }
}

// ============================================================
// visionCompletion — multimodal (imagen + texto) con function calling
// Misma interfaz que chatCompletion, pero messages puede tener image_url
// ============================================================
async function visionCompletion({ messages, tools, tool_choice, max_tokens, model, provider }) {
    const selectedProvider = provider || getVisionProvider();
    if (selectedProvider === 'openai') {
        return _visionOpenAI({ messages, tools, tool_choice, max_tokens, model });
    } else if (selectedProvider === 'anthropic') {
        return _visionAnthropic({ messages, tools, tool_choice, max_tokens, model });
    } else if (selectedProvider === 'openrouter') {
        return _visionOpenRouter({ messages, tools, tool_choice, max_tokens, model });
    } else {
        return _visionGemini({ messages, tools, tool_choice, max_tokens, model });
    }
}

// ============================================================
// OpenAI implementations (directo, ya funciona)
// ============================================================
async function _chatOpenAI({ messages, tools, tool_choice, max_tokens, model }) {
    const selectedModel = model || MODELS.openai.chat;
    const options = {
        model: selectedModel,
        messages,
        tools,
        tool_choice,
        max_completion_tokens: max_tokens  // GPT-5 models require max_completion_tokens
    };
    if (tools && tools.length > 0) {
        options.parallel_tool_calls = false;
    }
    if (_lastLoggedOpenAIModel !== selectedModel) {
        console.log(`🤖 [ModelSwitch] Using OpenAI model: ${selectedModel}`);
        _lastLoggedOpenAIModel = selectedModel;
    }
    return _openai.chat.completions.create(options);
}

async function _visionOpenAI({ messages, tools, tool_choice, max_tokens }) {
    const options = {
        model: MODELS.openai.vision,
        messages,
        tools,
        tool_choice,
        max_completion_tokens: max_tokens  // GPT-5 models require max_completion_tokens
    };
    if (tools && tools.length > 0) {
        options.parallel_tool_calls = false;
    }
    return _openai.chat.completions.create(options);
}

async function _chatInception({ messages, tools, tool_choice, max_tokens, model }) {
    if (!_inception) throw new Error('Inception not initialized');
    const selectedModel = model || MODELS.inception.chat;
    const options = {
        model: selectedModel,
        messages,
        tools,
        tool_choice,
        max_tokens: max_tokens || 1024
    };
    if (tools && tools.length > 0) {
        options.parallel_tool_calls = false;
    }
    if (_lastLoggedInceptionModel !== selectedModel) {
        console.log(`🤖 [ModelSwitch] Using Inception model: ${selectedModel}`);
        _lastLoggedInceptionModel = selectedModel;
    }
    return _inception.chat.completions.create(options);
}

async function _chatOpenRouter({ messages, tools, tool_choice, max_tokens, model }) {
    if (!_openrouter) throw new Error('OpenRouter not initialized');
    const selectedModel = model || MODELS.openrouter.chat;
    const hasTools = Array.isArray(tools) && tools.length > 0;
    const normalizedToolChoice = tool_choice === 'required' ? 'auto' : tool_choice;
    const baseOptions = {
        model: selectedModel,
        messages,
        tools,
        max_tokens: max_tokens || 1024
    };
    if (normalizedToolChoice) {
        baseOptions.tool_choice = normalizedToolChoice;
    }
    if (hasTools) {
        baseOptions.parallel_tool_calls = false;
    }
    if (_lastLoggedOpenRouterModel !== selectedModel) {
        console.log(`🤖 [ModelSwitch] Using OpenRouter model: ${selectedModel}`);
        _lastLoggedOpenRouterModel = selectedModel;
    }
    if (tool_choice === 'required' && !_warnedOpenRouterRequiredToolChoice) {
        console.warn('⚠️ [ModelSwitch] OpenRouter no estandariza tool_choice="required". Usando tool_choice="auto" y validando tool_calls.');
        _warnedOpenRouterRequiredToolChoice = true;
    }

    const attempts = [
        {
            label: 'require_parameters=true',
            options: {
                ...baseOptions,
                provider: {
                    require_parameters: true
                }
            }
        },
        {
            label: 'require_parameters=false',
            options: { ...baseOptions }
        },
        {
            label: 'sin tool_choice',
            options: (() => {
                const opts = { ...baseOptions };
                delete opts.tool_choice;
                return opts;
            })()
        }
    ];

    let lastError = null;
    for (const attempt of attempts) {
        try {
            const response = await _openrouter.chat.completions.create(attempt.options);
            if (tool_choice === 'required' && hasTools && !_responseHasToolCalls(response)) {
                throw new Error(`[ModelSwitch] OpenRouter respondió sin tool_calls en intento "${attempt.label}"`);
            }
            return response;
        } catch (error) {
            lastError = error;
            if (_isOpenRouterMissingToolCallsError(error)) {
                console.warn(`⚠️ [ModelSwitch] OpenRouter no devolvió tool_calls (${attempt.label}). Reintentando...`);
                continue;
            }
            if (_isOpenRouterRoutingNotFoundError(error)) {
                console.warn(`⚠️ [ModelSwitch] OpenRouter routing error (${attempt.label}). Reintentando...`);
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}

async function _visionOpenRouter({ messages, tools, tool_choice, max_tokens, model }) {
    if (!_openrouter) throw new Error('OpenRouter not initialized');
    const selectedModel = model || MODELS.openrouter.vision || MODELS.openrouter.chat;
    const hasTools = Array.isArray(tools) && tools.length > 0;
    const normalizedToolChoice = tool_choice === 'required' ? 'auto' : tool_choice;
    const options = {
        model: selectedModel,
        messages,
        tools,
        max_tokens: max_tokens || 1024
    };
    if (normalizedToolChoice) {
        options.tool_choice = normalizedToolChoice;
    }
    if (hasTools) {
        options.parallel_tool_calls = false;
    }
    if (tool_choice === 'required') {
        console.warn('⚠️ [ModelSwitch] OpenRouter no estandariza tool_choice="required" en vision. Usando tool_choice="auto".');
    }
    const response = await _openrouter.chat.completions.create(options);
    if (tool_choice === 'required' && hasTools && !_responseHasToolCalls(response)) {
        throw new Error('[ModelSwitch] OpenRouter vision respondió sin tool_calls con tool_choice requerido');
    }
    return response;
}

function _isOpenRouterRoutingNotFoundError(error) {
    const status = error?.status;
    const message = String(error?.error?.message || error?.message || '').toLowerCase();
    return status === 404 && message.includes('no endpoints found');
}

function _isOpenRouterMissingToolCallsError(error) {
    const message = String(error?.error?.message || error?.message || '').toLowerCase();
    return message.includes('openrouter') && message.includes('sin tool_calls');
}

function _isOpenRouterToolCallingFailure(error) {
    return _isOpenRouterRoutingNotFoundError(error) || _isOpenRouterMissingToolCallsError(error);
}

function _responseHasToolCalls(response) {
    return Array.isArray(response?.choices?.[0]?.message?.tool_calls)
        && response.choices[0].message.tool_calls.length > 0;
}

// ============================================================
// Gemini implementations — adapta formato OpenAI → Gemini → OpenAI
// ============================================================

/**
 * Convierte tools de formato OpenAI a formato Gemini
 */
function _convertToolsToGemini(tools) {
    if (!tools || tools.length === 0) return undefined;
    return [{
        functionDeclarations: tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters
        }))
    }];
}

/**
 * Convierte tool_choice de OpenAI a Gemini toolConfig
 */
function _convertToolChoiceToGemini(tool_choice) {
    if (!tool_choice) return undefined;
    if (tool_choice === 'required') {
        return { functionCallingConfig: { mode: 'ANY' } };
    }
    if (tool_choice === 'auto') {
        return { functionCallingConfig: { mode: 'AUTO' } };
    }
    if (tool_choice === 'none') {
        return { functionCallingConfig: { mode: 'NONE' } };
    }
    return undefined;
}

/**
 * Convierte messages de formato OpenAI a formato Gemini contents
 */
function _convertMessagesToGemini(messages) {
    const systemInstruction = [];
    const contents = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            systemInstruction.push(msg.content);
            continue;
        }

        if (msg.role === 'tool') {
            // Tool result → Gemini functionResponse
            // ContextManager saves the function name in msg.name (via getHistoryForAPI)
            contents.push({
                role: 'function',
                parts: [{
                    functionResponse: {
                        name: msg.name || msg._functionName || 'unknown',
                        response: { result: msg.content }
                    }
                }]
            });
            continue;
        }

        if (msg.role === 'assistant') {
            const parts = [];
            if (msg.content) {
                parts.push({ text: msg.content });
            }
            if (msg.tool_calls) {
                for (const tc of msg.tool_calls) {
                    parts.push({
                        functionCall: {
                            name: tc.function.name,
                            args: JSON.parse(tc.function.arguments)
                        }
                    });
                }
            }
            if (parts.length > 0) {
                contents.push({ role: 'model', parts });
            }
            continue;
        }

        // User message
        if (typeof msg.content === 'string') {
            contents.push({ role: 'user', parts: [{ text: msg.content }] });
        } else if (Array.isArray(msg.content)) {
            const parts = [];
            for (const part of msg.content) {
                if (part.type === 'text') {
                    parts.push({ text: part.text });
                } else if (part.type === 'image_url') {
                    // Extract base64 from data URL
                    const url = part.image_url.url;
                    if (url.startsWith('data:')) {
                        const match = url.match(/^data:([^;]+);base64,(.+)$/);
                        if (match) {
                            parts.push({
                                inlineData: {
                                    mimeType: match[1],
                                    data: match[2]
                                }
                            });
                        }
                    }
                }
            }
            contents.push({ role: 'user', parts });
        }
    }

    return { systemInstruction: systemInstruction.join('\n'), contents };
}

/**
 * Convierte respuesta Gemini a formato OpenAI-compatible
 */
function _convertGeminiResponse(result) {
    const candidate = result.response.candidates?.[0];
    if (!candidate) {
        return { choices: [{ message: { content: '', tool_calls: null } }] };
    }

    const parts = candidate.content?.parts || [];
    let textContent = '';
    const toolCalls = [];

    for (const part of parts) {
        if (part.text) {
            textContent += part.text;
        }
        if (part.functionCall) {
            toolCalls.push({
                id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'function',
                function: {
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args || {})
                }
            });
        }
    }

    return {
        choices: [{
            message: {
                content: textContent || null,
                tool_calls: toolCalls.length > 0 ? toolCalls : null
            }
        }]
    };
}

async function _chatGemini({ messages, tools, tool_choice, max_tokens }) {
    const model = _gemini.getGenerativeModel({
        model: MODELS.gemini.chat,
        tools: _convertToolsToGemini(tools),
        toolConfig: _convertToolChoiceToGemini(tool_choice)
    });

    const { systemInstruction, contents } = _convertMessagesToGemini(messages);

    const result = await model.generateContent({
        systemInstruction: systemInstruction || undefined,
        contents,
        generationConfig: { maxOutputTokens: max_tokens || 1024 }
    });

    return _convertGeminiResponse(result);
}

async function _visionGemini({ messages, tools, tool_choice, max_tokens }) {
    // Same as chat — Gemini handles multimodal natively
    return _chatGemini({ messages, tools, tool_choice, max_tokens });
}

// ============================================================
// Exports
// ============================================================
module.exports = {
    MODELS,
    getChatProvider,
    getVisionProvider,
    getProviderSummary,
    initOpenAI,
    initOpenRouter,
    initGemini,
    initAnthropic,
    initInception,
    chatCompletion,
    visionCompletion,
    embedding,
    isReady,
    transcription
};

function isReady(options = {}) {
    const capability = options.capability || 'chat';
    const provider = options.provider || (capability === 'vision' ? getVisionProvider() : getChatProvider());
    return !!_resolveClient(provider);
}

// ============================================================
// Transcription — audio to text
// ============================================================
async function transcription({ filePath, buffer, mimeType }) {
    if (_openai) {
        return _transcriptionOpenAI(filePath);
    }
    if (_gemini) {
        return _transcriptionGemini({ buffer, mimeType });
    }
    return { text: "" };
}

async function _transcriptionOpenAI(filePath) {
    if (!_openai) return { text: "" };
    const fs = require('fs');
    return await _openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: "whisper-1",
    });
}

async function _transcriptionGemini({ buffer, mimeType }) {
    if (!_gemini) return { text: "" };
    try {
        // Use active Gemini family model to avoid 1.5 deprecation breakages
        const model = _gemini.getGenerativeModel({ model: MODELS.gemini.chat });
        const result = await model.generateContent([
            {
                inlineData: {
                    mimeType: mimeType || "audio/webm",
                    data: buffer.toString("base64")
                }
            },
            { text: "Transcribe this audio exactly as spoken. Return only the text." }
        ]);
        return { text: result.response.text().trim() };
    } catch (e) {
        console.error('❌ [ModelSwitch] Gemini transcription failed:', e.message);
        return { text: "" };
    }
}

// ============================================================
// Anthropic implementations — adapta formato OpenAI → Anthropic → OpenAI
// ============================================================

async function _chatAnthropic({ messages, tools, tool_choice, max_tokens }) {
    if (!_anthropic) throw new Error("Anthropic not initialized");

    const system = messages.find(m => m.role === 'system')?.content;

    // 1. Map OpenAI messages to Anthropic format
    let rawAnthropicMessages = messages.filter(m => m.role !== 'system').map(m => {
        if (m.role === 'user') {
            if (Array.isArray(m.content)) {
                return {
                    role: 'user',
                    content: m.content.map(c => {
                        if (c.type === 'image_url') {
                            const match = c.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
                            return {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: match ? match[1] : 'image/jpeg',
                                    data: match ? match[2] : ''
                                }
                            };
                        }
                        return { type: 'text', text: c.text };
                    })
                };
            }
            return { role: 'user', content: [{ type: 'text', text: m.content }] };
        }
        if (m.role === 'assistant') {
            const content = [];
            if (m.content !== null && m.content !== undefined && m.content !== "") {
                content.push({ type: 'text', text: m.content });
            }
            if (m.tool_calls && Array.isArray(m.tool_calls)) {
                m.tool_calls.forEach(tc => {
                    content.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.function.name,
                        input: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments
                    });
                });
            }

            if (content.length === 0) {
                // console.warn('⚠️ [ModelSwitch] Assistant message has empty content, skipping...');
                return null;
            }
            return { role: 'assistant', content };
        }
        if (m.role === 'tool') {
            return {
                role: 'user',
                content: [{
                    type: 'tool_result',
                    tool_use_id: m.tool_call_id,
                    content: m.content // content string matches Anthropic expectation
                }]
            };
        }
        return null;
    }).filter(m => m !== null);

    // 2. Merge consecutive messages with the same role AND ensure alternation
    const anthropicMessages = [];
    for (const msg of rawAnthropicMessages) {
        if (anthropicMessages.length > 0) {
            const lastMsg = anthropicMessages[anthropicMessages.length - 1];

            // Case 1: Same role -> Merge content
            if (lastMsg.role === msg.role) {
                lastMsg.content = lastMsg.content.concat(msg.content);
                continue;
            }

            // Case 2: Alternating roles -> Normal append
            anthropicMessages.push(msg);
        } else {
            // First message
            anthropicMessages.push(msg);
        }
    }

    // 3. Final cleanup: Ensure it starts with User (if system is separate) and doesn't end with User if we expect Assistant response? 
    // Actually Anthropic requires User -> Assistant -> User ... 
    // If we have User -> User (merged above) -> Assistant -> User -> User (merged) ... it should be fine.
    // The previous error `unexpected tool_use_id found in tool_result blocks` suggests a mismatch between tool_use and tool_result.
    // Each tool_result MUST follow the Assistant message that requested it.
    // If we have: User, Assistant(tool_use), User(tool_result), User(text) -> This is valid if merged to User(tool_result + text).
    // The merging above handles this.


    const anthropicTools = tools?.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
    }));

    // Tool choice handling
    let anthropicToolChoice = undefined;
    if (tool_choice) {
        if (tool_choice === 'auto') anthropicToolChoice = { type: 'auto' };
        else if (tool_choice === 'required') anthropicToolChoice = { type: 'any' };
        else if (typeof tool_choice === 'object' && tool_choice.function) {
            anthropicToolChoice = { type: 'tool', name: tool_choice.function.name };
        }
    }

    const msgOptions = {
        model: MODELS.anthropic.chat,
        max_tokens: max_tokens || 1024,
        messages: anthropicMessages,
        system: system,
        tools: anthropicTools,
        tool_choice: anthropicToolChoice
    };

    // DEBUG: Log payload size and structure (truncated)
    // console.log('📤 [ModelSwitch] Anthropic Payload:', JSON.stringify(msgOptions, null, 2).substring(0, 1000) + '...');

    let response;
    try {
        response = await _createAnthropicWithFallback(msgOptions);
    } catch (e) {
        console.error('❌ [ModelSwitch] Anthropic API Error:', e);
        console.error('Payload causing error:', JSON.stringify(msgOptions, null, 2));
        throw e;
    }

    // Convert response back to OpenAI format
    const content = response.content.find(c => c.type === 'text')?.text || null;
    const toolCalls = response.content.filter(c => c.type === 'tool_use').map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
            name: tc.name,
            arguments: JSON.stringify(tc.input)
        }
    }));

    return {
        choices: [{
            message: {
                content,
                tool_calls: toolCalls.length > 0 ? toolCalls : null
            }
        }]
    };
}

async function _visionAnthropic(params) {
    return _chatAnthropic(params); // Anthropic handles vision natively in chat
}

function _anthropicIsModelNotFoundError(error) {
    const type = error?.error?.error?.type || error?.error?.type;
    const message = error?.error?.error?.message || error?.error?.message || error?.message || '';
    return error?.status === 404 && (type === 'not_found_error' || message.includes('model:'));
}

function _anthropicFallbackModels(primaryModel) {
    const configured = (process.env.ANTHROPIC_FALLBACK_MODELS || '')
        .split(',')
        .map(m => m.trim())
        .filter(Boolean);

    const defaults = [
        'claude-haiku-4-5-20251001',
        'claude-sonnet-4-6',
        'claude-sonnet-4-20250514'
    ];

    return [...new Set([primaryModel, ...configured, ...defaults])];
}

async function _createAnthropicWithFallback(msgOptions) {
    const candidates = _anthropicFallbackModels(msgOptions.model);
    let lastError = null;

    for (let i = 0; i < candidates.length; i++) {
        const candidateModel = candidates[i];
        try {
            if (candidateModel !== msgOptions.model) {
                console.warn(`⚠️ [ModelSwitch] Retrying Anthropic with fallback model: ${candidateModel}`);
            }
            return await _anthropic.messages.create({
                ...msgOptions,
                model: candidateModel
            });
        } catch (e) {
            lastError = e;
            const canRetry = _anthropicIsModelNotFoundError(e) && i < candidates.length - 1;
            if (!canRetry) {
                throw e;
            }
        }
    }

    throw lastError;
}

// ============================================================
// Embedding — vector generation
// Interfaz unificada: retorna number[] (el vector)
// ============================================================
async function embedding(text) {
    if (_openai) {
        return _embeddingOpenAI(text);
    }
    if (_gemini) {
        return _embeddingGemini(text);
    }
    return null;
}

async function _embeddingOpenAI(text) {
    if (!_openai) return null;
    const response = await _openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
    });
    return response.data[0].embedding;
}

async function _embeddingGemini(text) {
    if (!_gemini) return null;
    try {
        // Updated to official "gemini-embedding-001" (July 2025 release)
        const model = _gemini.getGenerativeModel({ model: "gemini-embedding-001" });
        const result = await model.embedContent(text);
        return result.embedding.values;
    } catch (e) {
        console.error('❌ [ModelSwitch] Gemini embedding failed:', e.message);
        return null;
    }
}
