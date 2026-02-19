/**
 * WhatsAppContext.js
 * 
 * Analyzes the AX tree (or elements list) to extract conversation context.
 * Parses message bubbles, timestamps, and sender info.
 */

class WhatsAppContext {

    /**
     * Parses raw UI elements to extract message history
     * @param {Array} elements - List of UI elements from ScreenAgent
     * @returns {Object} { messages: Array, analysis: Object }
     */
    static parse(elements) {
        if (!elements || elements.length === 0) return { messages: [], analysis: {} };

        const messages = [];
        const dateMarkers = [];

        // Regex for WhatsApp message labels
        // Format example: "‎message, Hello there, 10:45 AM, ‎Received from Mom"
        // Also: "‎Your message, I'm good, 10:46 AM, ‎Sent to Mom, ‎Delivered"
        const MSG_REGEX = /^(?:‎)?(message|Your message|Voice message|Video|Photo|Sticker|GIF|File), (.+?), (\d{1,2}:\d{2}\s?[AP]M), (?:‎)?(Received from|Sent to) (.+?)(?:,|$)/i;

        // Regex for date markers (e.g. "Today", "Yesterday", "February 14")
        // Usually these are just static text or group labels in the list
        // Harder to detect generically, but we can look for short date-like strings centered in the list?
        // Actually, WhatsApp accessibility labels often include "Messages from Today" in a group label.

        // Sort elements by Y position (top to bottom)
        const sorted = [...elements].sort((a, b) => a.bbox.y - b.bbox.y);

        for (const el of sorted) {
            const label = el.label || '';

            // 1. Detect Messages
            const match = label.match(MSG_REGEX);
            if (match) {
                const [_, type, content, time, direction, contact] = match;

                const isMe = direction.toLowerCase().includes('sent to') || type.toLowerCase().includes('your message');
                const sender = isMe ? 'Me' : contact.trim();

                // Clean content (remove "‎" chars)
                let cleanContent = content.replace(/‎/g, '').trim();

                // Handle special types
                if (type.toLowerCase().includes('voice')) cleanContent = `[Voice Message] ${cleanContent}`;
                if (type.toLowerCase().includes('video')) cleanContent = `[Video] ${cleanContent}`;
                if (type.toLowerCase().includes('photo')) cleanContent = `[Photo] ${cleanContent}`;

                messages.push({
                    id: el.id,
                    sender: sender,
                    content: cleanContent,
                    time: time,
                    isMe: isMe,
                    raw: label,
                    y: el.bbox.y
                });
                continue;
            }

            // 2. Detect Date Markers (Heuristic)
            // WhatsApp often exposes "Today", "Yesterday" as separate text elements
            if (el.type === 'text' || el.role === 'AXStaticText') {
                const txt = label.trim().toLowerCase();
                if (['today', 'yesterday', 'hoy', 'ayer'].includes(txt) || /^\w+ \d{1,2}$/.test(txt)) {
                    dateMarkers.push({ text: label, y: el.bbox.y });
                }
            }
        }

        return {
            messages,
            analysis: this._analyze(messages, dateMarkers)
        };
    }

    static _analyze(messages, dateMarkers) {
        if (messages.length === 0) return { hasContext: false, suggestion: null };

        const topMessage = messages[0];
        const bottomMessage = messages[messages.length - 1];

        // Context Check: Do we have a date marker above the top message?
        const hasDateHeader = dateMarkers.some(m => m.y < topMessage.y);

        // Time gap check (if top message is very recent, we might miss context)
        // This is hard without full date parsing, but we can guess.

        let suggestion = null;
        if (!hasDateHeader && messages.length < 5) {
            suggestion = "SCROLL_UP"; // Low context count and no header
        }

        return {
            messageCount: messages.length,
            hasDateHeader,
            participants: [...new Set(messages.map(m => m.sender))],
            suggestion
        };
    }

    /**
     * Format as a prompt-friendly string
     */
    static formatForPrompt(parsed) {
        if (parsed.messages.length === 0) return "  (No se detectaron mensajes legibles)";

        let output = "📜 **HISTORIAL DE CHAT DETECTADO:**\n";

        if (parsed.analysis.hasDateHeader) {
            output += "  [Inicio de mensajes visibles]\n";
        } else {
            output += "  [... mensajes anteriores ...]\n";
        }

        parsed.messages.forEach(m => {
            const arrow = m.isMe ? "📤" : "📥";
            output += `  ${arrow} ${m.sender} [${m.time}]: ${m.content}\n`;
        });

        if (parsed.analysis.suggestion === 'SCROLL_UP') {
            output += "\n⚠️ SUGERENCIA: Parece haber pocos mensajes. Si necesitas más contexto, usa la acción de scroll hacia arriba.";
        }

        return output;
    }
}

module.exports = WhatsAppContext;
