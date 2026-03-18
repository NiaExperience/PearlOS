"""
MSAM Annotation Engine
Fast-path heuristic annotations + optional LLM slow-path.
"""

import re
import json

from .config import get_config as _get_config
_cfg = _get_config()

# ─── Fast Path: Heuristic Annotations ────────────────────────────

# High-arousal indicators
HIGH_AROUSAL_PATTERNS = [
    r'\b(urgent|emergency|critical|panic|terrified|furious|ecstatic|thrilled)\b',
    r'[!]{2,}',
    r'[A-Z]{4,}',  # ALL CAPS words
    r'\b(love|hate|angry|scared|excited|amazing|terrible|horrible)\b',
]

# Valence indicators
POSITIVE_PATTERNS = [
    r'\b(love|happy|great|amazing|wonderful|excellent|perfect|beautiful|grateful|proud)\b',
    r'\b(excited|thrilled|glad|pleased|enjoy|fun|awesome|fantastic)\b',
]

NEGATIVE_PATTERNS = [
    r'\b(hate|sad|angry|terrible|horrible|awful|worst|disappointed|frustrated|upset)\b',
    r'\b(scared|afraid|worried|anxious|stressed|painful|hurts|miss|lonely)\b',
]

# Topic extraction patterns
TOPIC_PATTERNS = {
    'health': r'\b(sleep|tired|rest|sick|pain|injury|doctor|medicine|eat|hydrat)\w*\b',
    'work': r'\b(work|job|career|project|task|deadline|meeting|schedule)\w*\b',
    'technology': r'\b(code|program|server|api|database|deploy|bug|config|system)\w*\b',
    'relationship': r'\b(friend|family|partner|trust|together|support|care|miss)\w*\b',
    'entertainment': r'\b(movie|anime|music|game|watch|play|listen|read|book)\w*\b',
    'travel': r'\b(hotel|flight|city|travel|tour|venue|airport)\w*\b',
    'memory': r'\b(remember|forgot|memory|recall|remind)\w*\b',
    'emotion': r'\b(feel|emotion|mood|happy|sad|angry|scared|love|hate)\w*\b',
}


def heuristic_annotate(content: str) -> dict:
    """
    Fast-path annotation using pattern matching.
    Returns arousal, valence, topics, confidence.
    """
    content_lower = content.lower()
    
    # Arousal: 0.0-1.0
    arousal_hits = sum(
        len(re.findall(p, content_lower)) 
        for p in HIGH_AROUSAL_PATTERNS
    )
    arousal = min(0.3 + arousal_hits * 0.15, 1.0)
    
    # Valence: -1.0 to 1.0
    pos_hits = sum(len(re.findall(p, content_lower)) for p in POSITIVE_PATTERNS)
    neg_hits = sum(len(re.findall(p, content_lower)) for p in NEGATIVE_PATTERNS)
    total_val = pos_hits + neg_hits
    if total_val > 0:
        valence = (pos_hits - neg_hits) / total_val
    else:
        valence = 0.0
    
    # Topics
    topics = []
    for topic, pattern in TOPIC_PATTERNS.items():
        if re.search(pattern, content_lower):
            topics.append(topic)
    
    # Confidence (heuristic is lower confidence than LLM)
    confidence = 0.5
    
    return {
        "arousal": round(arousal, 2),
        "valence": round(valence, 2),
        "topics": topics[:5],  # max 5 topics
        "encoding_confidence": confidence,
    }


# ─── Profile Classification ──────────────────────────────────────

def classify_profile(content: str) -> str:
    """
    Classify atom into lightweight/standard/full profile.
    Based on content complexity and length.
    """
    words = content.split()
    word_count = len(words)
    
    # Simple facts: short, declarative
    _lightweight_max = _cfg('atoms', 'profile_lightweight_max_words', 20)
    if word_count <= _lightweight_max:
        return "lightweight"

    # Rich content: long, complex
    _full_min = _cfg('atoms', 'profile_full_min_words', 80)
    if word_count > _full_min:
        return "full"
    
    return "standard"


# ─── Stream Classification ───────────────────────────────────────

def classify_stream(content: str, source: str = "conversation") -> str:
    """
    Classify which memory stream an atom belongs to.
    Streams: semantic (facts/knowledge), episodic (events/experiences), procedural (how-to/rules).
    """
    content_lower = content.lower()

    # Procedural: how-to, instructions, commands, rules, workflows
    PROCEDURAL_PATTERNS = [
        r'\bhow to\b', r'\bstep 1\b', r'\bcommand:', r'(?<!\w)run ', r'\bexecute\b', r'\bto do this\b',
        r'\bconfig\b', r'\binstall\b', r'\bsetup\b', r'\bworkflow\b', r'\bpipeline\b',
        r'\balways\b', r'\bnever\b', r'\brule:', r'\bprotocol:',
        r'\binstructions:', r'\bprocedure:', r'\bsteps:', r'\bguide:',
    ]
    if any(re.search(p, content_lower) for p in PROCEDURAL_PATTERNS):
        return "procedural"

    # Procedural: regex for conditional patterns
    if re.search(r'\bif\b.{1,40}\bthen\b', content_lower):
        return "procedural"
    if re.search(r'\bwhen\b.{1,40}\b(do|use|run|check|always)\b', content_lower):
        return "procedural"

    # Episodic: time-bound events, experiences, conversations, sessions
    EPISODIC_KEYWORDS = [
        'today', 'yesterday', 'last night', 'this morning', 'we talked', 'happened', 'said that',
        # Conversation events
        'user said', 'we decided', 'discussed', 'conversation about', 'mentioned',
        'told me', 'asked me', 'we agreed', 'i told', 'agent said',
        # Session references
        'session', 'this session', 'during the', 'last session',
        # Activity references
        'watched', 'went to', 'played', 'worked on', 'built', 'implemented',
        'deployed', 'tested', 'installed', 'fixed', 'shipped',
        # Relative time
        'this week', 'last week', 'this month', 'earlier today', 'just now',
        'recently', 'a few days ago', 'a while ago',
    ]
    if any(kw in content_lower for kw in EPISODIC_KEYWORDS):
        return "episodic"

    # Episodic: explicit date patterns (YYYY-MM-DD, "at HH:MM", "on Monday", month names)
    MONTH_NAMES = r'\b(january|february|march|april|may|june|july|august|september|october|november|december)\b'
    DAY_NAMES = r'\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b'
    if re.search(r'\b\d{4}-\d{2}-\d{2}\b', content_lower):
        return "episodic"
    if re.search(r'\bat \d{1,2}:\d{2}\b', content_lower):
        return "episodic"
    if re.search(DAY_NAMES, content_lower):
        return "episodic"
    if re.search(MONTH_NAMES, content_lower):
        return "episodic"

    # Default: semantic (facts, knowledge)
    return "semantic"


# ─── Slow Path: LLM-Powered Annotations ─────────────────────────

import os
import requests
from .config import get_config

_cfg = get_config()

_LLM_ANNOTATION_PROMPT = """Analyze the following text and return a JSON object with these fields:
- arousal: float 0.0 to 1.0 (emotional intensity)
- valence: float -1.0 to 1.0 (negative to positive sentiment)
- topics: list of up to 5 topic strings
- stream: one of "semantic", "episodic", "procedural"
- encoding_confidence: float 0.0 to 1.0 (how confident you are in this analysis)

Return ONLY valid JSON, no explanation.

Text: {content}"""


def llm_annotate(content: str) -> dict:
    """
    Slow-path annotation using an LLM endpoint (NVIDIA NIM).
    Falls back to heuristic_annotate on any failure.
    """
    llm_url = _cfg('annotation', 'llm_url', 'https://integrate.api.nvidia.com/v1/chat/completions')
    llm_model = _cfg('annotation', 'llm_model', 'mistralai/mistral-large-3-675b-instruct-2512')
    timeout = _cfg('annotation', 'timeout_seconds', 15)

    api_key = os.environ.get("NVIDIA_NIM_API_KEY")
    if not api_key:
        return heuristic_annotate(content)  # fallback

    prompt = _LLM_ANNOTATION_PROMPT.format(content=content[:2000])

    try:
        r = requests.post(
            llm_url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": llm_model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
                "max_tokens": 500,
            },
            timeout=timeout,
        )
        r.raise_for_status()
        response_text = r.json()["choices"][0]["message"]["content"].strip()
    except Exception:
        return heuristic_annotate(content)  # fallback

    # Parse and validate JSON response
    try:
        # Strip markdown code fences if present
        text = response_text
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        data = json.loads(text)

        # Validate and clamp ranges
        arousal = max(0.0, min(1.0, float(data.get("arousal", 0.5))))
        valence = max(-1.0, min(1.0, float(data.get("valence", 0.0))))
        encoding_confidence = max(0.0, min(1.0, float(data.get("encoding_confidence", 0.7))))

        topics = data.get("topics", [])
        if not isinstance(topics, list):
            topics = []
        topics = [str(t) for t in topics[:5]]

        stream = data.get("stream", "semantic")
        if stream not in ("semantic", "episodic", "procedural"):
            stream = "semantic"

        return {
            "arousal": round(arousal, 2),
            "valence": round(valence, 2),
            "topics": topics,
            "encoding_confidence": round(encoding_confidence, 2),
            "stream": stream,
        }
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        return heuristic_annotate(content)  # fallback


def smart_annotate(content: str, use_llm: bool = False) -> dict:
    """
    Unified annotation entry point.
    If use_llm is True, attempts LLM annotation first, falling back to heuristic.
    If use_llm is False, uses heuristic annotation directly.
    Always returns a valid annotation dict.
    """
    if use_llm:
        try:
            return llm_annotate(content)
        except Exception:
            return heuristic_annotate(content)
    return heuristic_annotate(content)
