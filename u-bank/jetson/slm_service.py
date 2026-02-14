#!/usr/bin/env python3
"""
SLM Service — Small Language Model for Natural Language Understanding.

Runs on Jetson Orin Nano. Takes user speech transcription and extracts
structured intent + parameters.

Model options (ranked by speed on Jetson 8GB):
  1. Gemma 2B (google/gemma-2-2b-it) — fastest, good enough for NLU
  2. Phi-3-mini 3.8B (microsoft/Phi-3-mini-4k-instruct) — better reasoning
  3. Qwen2.5 3B (Qwen/Qwen2.5-3B-Instruct) — good multilingual (Spanish)

Uses llama-cpp-python for efficient inference on Jetson CUDA.
"""

import json
import logging
import os
import time
from typing import Dict, Any, Optional
from dataclasses import dataclass, field

logger = logging.getLogger('SLMService')

# ============================================
# Configuration
# ============================================

SLM_MODEL_PATH = os.environ.get(
    'SLM_MODEL_PATH',
    os.path.expanduser('~/.cache/u-bank/models/gemma-2-2b-it-Q4_K_M.gguf')
)

# System prompt for banking NLU
SYSTEM_PROMPT = """Eres el módulo NLU de Ü, un asistente bancario inteligente para Bancolombia.
Tu trabajo es extraer la intención del usuario a partir de su mensaje de voz en español.

REGLAS:
- Responde SOLO con JSON válido, sin texto adicional
- Extrae montos numéricos (50 mil = 50000, un millón = 1000000)
- Identifica nombres de personas como recipients
- Detecta fuentes de dinero (bolsillo, cuenta principal)
- Si no estás seguro, usa confidence < 0.7

INTENCIONES SOPORTADAS:
- send_money: Enviar/transferir dinero a alguien
- check_balance: Consultar saldo o movimientos
- transfer_pocket: Mover dinero entre bolsillos
- pay_bill: Pagar un servicio (luz, agua, internet, etc.)
- transaction_history: Ver historial de transacciones
- open_app: Solo abrir la app del banco

FORMATO DE RESPUESTA:
{
  "intent": "send_money",
  "confidence": 0.95,
  "params": {
    "amount": 50000,
    "recipient": "María",
    "source": "cuenta_principal"
  }
}"""

# Amount parsing patterns (Spanish)
AMOUNT_PATTERNS = {
    "mil": 1000,
    "millón": 1000000,
    "millon": 1000000,
    "millones": 1000000,
    "luca": 1000,
    "lucas": 1000,
    "palo": 1000000,
    "palos": 1000000,
}


# ============================================
# SLM Wrapper
# ============================================

class SLMService:
    """
    Small Language Model service for intent extraction.
    Uses llama-cpp-python for efficient GGUF inference on Jetson.
    """

    def __init__(self, model_path: str = SLM_MODEL_PATH):
        self.model_path = model_path
        self.llm = None
        self.loaded = False

    def load(self) -> bool:
        """Load the SLM model"""
        try:
            from llama_cpp import Llama

            if not os.path.exists(self.model_path):
                logger.error(f"Model not found: {self.model_path}")
                logger.info("Download with: huggingface-cli download google/gemma-2-2b-it-GGUF gemma-2-2b-it-Q4_K_M.gguf")
                return False

            logger.info(f"Loading SLM: {self.model_path}")
            start = time.time()

            self.llm = Llama(
                model_path=self.model_path,
                n_ctx=2048,         # Context window
                n_gpu_layers=-1,    # All layers on GPU (Jetson CUDA)
                n_threads=4,        # CPU threads for non-GPU ops
                verbose=False
            )

            elapsed = time.time() - start
            logger.info(f"SLM loaded in {elapsed:.1f}s")
            self.loaded = True
            return True

        except ImportError:
            logger.error("llama-cpp-python not installed. Install with: pip install llama-cpp-python")
            return False
        except Exception as e:
            logger.error(f"Failed to load SLM: {e}")
            return False

    def extract_intent(self, text: str) -> Dict[str, Any]:
        """
        Extract structured intent from user speech text.
        
        Args:
            text: Transcribed user speech (Spanish)
            
        Returns:
            {
                "intent": str,
                "confidence": float,
                "params": dict,
                "raw_text": str,
                "inference_time_ms": int
            }
        """
        start = time.time()

        if self.llm and self.loaded:
            result = self._llm_extract(text)
        else:
            # Fallback: rule-based extraction
            logger.warning("SLM not loaded, using rule-based extraction")
            result = self._rule_based_extract(text)

        result["raw_text"] = text
        result["inference_time_ms"] = int((time.time() - start) * 1000)

        logger.info(
            f"Intent: {result['intent']} "
            f"(confidence: {result['confidence']:.2f}, "
            f"{result['inference_time_ms']}ms)"
        )

        return result

    def _llm_extract(self, text: str) -> Dict[str, Any]:
        """Extract intent using the LLM"""
        try:
            response = self.llm.create_chat_completion(
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": text}
                ],
                max_tokens=256,
                temperature=0.1,  # Low temperature for deterministic output
                response_format={"type": "json_object"}
            )

            content = response["choices"][0]["message"]["content"]
            parsed = json.loads(content)

            return {
                "intent": parsed.get("intent", "unknown"),
                "confidence": parsed.get("confidence", 0.5),
                "params": parsed.get("params", {})
            }

        except (json.JSONDecodeError, KeyError, IndexError) as e:
            logger.error(f"Failed to parse LLM response: {e}")
            return self._rule_based_extract(text)

    def _rule_based_extract(self, text: str) -> Dict[str, Any]:
        """
        Rule-based intent extraction fallback.
        Works without LLM for testing and when model isn't loaded.
        """
        text_lower = text.lower().strip()

        # Detect intent
        intent = "unknown"
        confidence = 0.6
        params = {}

        # Send money patterns
        send_keywords = ["envía", "envia", "enviar", "transfiere", "transferir",
                         "manda", "mandar", "pasa", "pasar", "gira", "girar"]
        if any(kw in text_lower for kw in send_keywords):
            intent = "send_money"
            confidence = 0.85

        # Check balance
        balance_keywords = ["saldo", "cuánto tengo", "cuanto tengo", "balance",
                           "plata tengo", "dinero tengo"]
        if any(kw in text_lower for kw in balance_keywords):
            intent = "check_balance"
            confidence = 0.9

        # Pay bill
        pay_keywords = ["paga", "pagar", "servicio", "factura", "recibo"]
        if any(kw in text_lower for kw in pay_keywords):
            intent = "pay_bill"
            confidence = 0.8

        # Pocket operations
        pocket_keywords = ["bolsillo", "pocket", "ahorro"]
        if any(kw in text_lower for kw in pocket_keywords):
            if intent == "send_money":
                params["source"] = "bolsillo_ahorros"
            else:
                intent = "transfer_pocket"
                confidence = 0.8

        # Extract amount
        amount = self._extract_amount(text_lower)
        if amount:
            params["amount"] = amount

        # Extract recipient (simple: word after "a" that's capitalized in original)
        recipient = self._extract_recipient(text)
        if recipient:
            params["recipient"] = recipient

        return {
            "intent": intent,
            "confidence": confidence,
            "params": params
        }

    def _extract_amount(self, text: str) -> Optional[int]:
        """Extract monetary amount from Spanish text"""
        import re

        # Pattern: number + mil/millón
        # "50 mil" → 50000, "un millón" → 1000000
        patterns = [
            (r'(\d+)\s*mil', lambda m: int(m.group(1)) * 1000),
            (r'(\d+)\s*mill[oó]n(?:es)?', lambda m: int(m.group(1)) * 1000000),
            (r'(\d+)\s*lucas?', lambda m: int(m.group(1)) * 1000),
            (r'(\d+)\s*palos?', lambda m: int(m.group(1)) * 1000000),
            (r'\$\s*([\d,.]+)', lambda m: int(m.group(1).replace(',', '').replace('.', ''))),
            (r'(\d{4,})', lambda m: int(m.group(1))),  # Raw number >= 1000
        ]

        for pattern, extractor in patterns:
            match = re.search(pattern, text)
            if match:
                try:
                    return extractor(match)
                except (ValueError, IndexError):
                    continue

        # Special: "un millón" without number
        if "un mill" in text:
            return 1000000

        return None

    def _extract_recipient(self, text: str) -> Optional[str]:
        """Extract recipient name from text"""
        import re

        # Look for "a [Name]" pattern where Name is capitalized
        # "Envía 50 mil a María" → "María"
        match = re.search(r'\ba\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)', text)
        if match:
            name = match.group(1)
            # Filter out common non-name words
            skip_words = {"Bancolombia", "Nequi", "Daviplata", "Cuenta", "Bolsillo"}
            if name not in skip_words:
                return name

        return None


# ============================================
# Self-test
# ============================================

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    slm = SLMService()
    # Don't load model for testing — use rule-based

    test_phrases = [
        "Envía 50 mil a María",
        "Transfiere un millón a Carlos del bolsillo de ahorros",
        "Cuánto tengo en mi cuenta",
        "Paga el recibo de la luz",
        "Manda 200 lucas a Pedro",
        "Pasa 30 mil a Juan",
    ]

    for phrase in test_phrases:
        result = slm.extract_intent(phrase)
        print(f"\n  \"{phrase}\"")
        print(f"  → intent: {result['intent']}")
        print(f"  → confidence: {result['confidence']}")
        print(f"  → params: {result['params']}")
        print(f"  → time: {result['inference_time_ms']}ms")
