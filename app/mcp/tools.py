"""What every MCP tool shares: times in a recording as mm:ss or h:mm:ss,
the limit of an answer, and refusals of one line. No MCP imports here, so the
formats are tested on their own."""
import re

from app.services.transcript_text import clock

__all__ = ["MAX_CHARS", "Refused", "clock", "fit", "parse_clock"]

# The longest answer of a tool. Claude Code warns from about 10,000 tokens and
# cuts at 25,000: 40,000 characters stay well inside in any language.
MAX_CHARS = 40_000

_CLOCK = re.compile(r"^(?:(\d+):)?(\d{1,2}):(\d{2})$")
_SECONDS = re.compile(r"^\d+(?:\.\d+)?$")


class Refused(ValueError):
    """A request a tool cannot answer; the message is one line: what happened,
    then what to do."""


def parse_clock(value) -> float:
    """Seconds from mm:ss, h:mm:ss or a number of seconds (also as text)."""
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
        return float(value) if isinstance(value, float) else value
    text = str(value).strip()
    if _SECONDS.match(text):
        return float(text) if "." in text else int(text)
    match = _CLOCK.match(text)
    if match and int(match[3]) < 60 and (match[1] is None or int(match[2]) < 60):
        hours, minutes, seconds = (int(part or 0) for part in match.groups())
        return hours * 3600 + minutes * 60 + seconds
    raise Refused(f"{value!r} is not a time: write it as mm:ss, h:mm:ss or seconds.")


def fit(text: str, limit: int = MAX_CHARS) -> str:
    """The answer as it is, or its first lines within limit and a line saying
    how many were left out. Tools keep within the limit themselves; this is the
    last guard."""
    if len(text) <= limit:
        return text
    lines = text.split("\n")
    kept, size = [], 0
    for line in lines:
        # Room for the closing line, whatever the count.
        if size + len(line) + 1 > limit - 60:
            break
        kept.append(line)
        size += len(line) + 1
    return "\n".join(kept + [f"… {len(lines) - len(kept)} more lines not shown."])
