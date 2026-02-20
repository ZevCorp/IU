/**
 * ModelSwitch.js
 * Switch fácil entre OpenAI (GPT-4.1-mini) y Google Gemini (2.5 Flash).
 * 
 * Para cambiar de provider, modifica PROVIDER abajo o usa env var VISION_PROVIDER.
 * 
 * Uso:
 *   const { chatCompletion, visionCompletion, PROVIDER } = require('./ModelSwitch');
 *   // Ambas funciones tienen la misma interfaz de entrada/salida.
 */

// ============================================================
// 🔀 SWITCH: Cambia aquí o con env vars
//    VISION_PROVIDER: "openai" | "gemini"
//    VISION_MODEL: "nano" | "mini" | "full" (solo para OpenAI)
// 
// Ejemplos en .env:
//    VISION_PROVIDER=openai
//    VISION_MODEL=full      # gpt-4.1 (más preciso, más caro)
//    VISION_MODEL=mini      # gpt-4.1-mini (balance)
//    VISION_MODEL=nano      # gpt-4.1-nano (rápido, barato)
// ============================================================
const PROVIDER = process.env.VISION_PROVIDER || 'openai';
const VISION_MODEL = process.env.VISION_MODEL || 'nano'; // nano | mini | full

// Clients — se inicializan desde main.js
let _openai = null;
let _gemini = null;

function initOpenAI(openaiClient) {
    _openai = openaiClient;
}

function initGemini(apiKey) {
    if (!apiKey) return;
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    _gemini = new GoogleGenerativeAI(apiKey);
    console.log('✅ Gemini initialized (ModelSwitch)');
}

// ============================================================
// Modelos por provider
// ============================================================
const OPENAI_MODELS = {
    nano: 'gpt-4.1-nano',
    mini: 'gpt-4.1-mini',
    full: 'gpt-4.1'
};

const MODELS = {
    openai: {
        chat: OPENAI_MODELS[VISION_MODEL] || OPENAI_MODELS.nano,
        vision: OPENAI_MODELS[VISION_MODEL] || OPENAI_MODELS.nano
    },
    gemini: {
        chat: 'gemini-2.5-flash',
        vision: 'gemini-2.5-flash'
    }
};

// ============================================================
// chatCompletion — texto puro con function calling
// Interfaz unificada: { messages, tools, tool_choice, max_tokens }
// Retorna: formato OpenAI-compatible { choices: [{ message: { content, tool_calls } }] }
// ============================================================
async function chatCompletion({ messages, tools, tool_choice, max_tokens }) {
    if (PROVIDER === 'openai') {
        return _chatOpenAI({ messages, tools, tool_choice, max_tokens });
    } else {
        return _chatGemini({ messages, tools, tool_choice, max_tokens });
    }
}

// ============================================================
// visionCompletion — multimodal (imagen + texto) con function calling
// Misma interfaz que chatCompletion, pero messages puede tener image_url
// ============================================================
async function visionCompletion({ messages, tools, tool_choice, max_tokens }) {
    if (PROVIDER === 'openai') {
        return _visionOpenAI({ messages, tools, tool_choice, max_tokens });
    } else {
        return _visionGemini({ messages, tools, tool_choice, max_tokens });
    }
}

// ============================================================
// OpenAI implementations (directo, ya funciona)
// ============================================================
async function _chatOpenAI({ messages, tools, tool_choice, max_tokens }) {
    return _openai.chat.completions.create({
        model: MODELS.openai.chat,
        messages,
        tools,
        tool_choice,
        max_tokens
    });
}

async function _visionOpenAI({ messages, tools, tool_choice, max_tokens }) {
    return _openai.chat.completions.create({
        model: MODELS.openai.vision,
        messages,
        tools,
        tool_choice,
        max_tokens
    });
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
            contents.push({
                role: 'function',
                parts: [{
                    functionResponse: {
                        name: msg._functionName || 'unknown',
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
    PROVIDER,
    MODELS,
    initOpenAI,
    initGemini,
    chatCompletion,
    visionCompletion
};
