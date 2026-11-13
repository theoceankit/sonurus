"""Speaker handles (@ivan.petrov): made from a name, unique among speakers.

Pure functions. The handle is a Latin form of the name in one of HANDLE_FORMATS;
Cyrillic goes by the Russian passport scheme, other Latin letters lose their
accents, everything else is dropped. A handle that is taken gets the smallest
free number from 2 on its end.
"""
import re
import unicodedata

HANDLE_FORMATS = ("first.last", "f.last", "first.l")
DEFAULT_FORMAT = "first.last"
MAX_LENGTH = 32
FALLBACK = "speaker"

_VALID = re.compile(rf"^[a-z0-9][a-z0-9._-]{{0,{MAX_LENGTH - 1}}}$")
_SEPARATORS = "._-"

_CYRILLIC = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh",
    "з": "z", "и": "i", "й": "i", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
    "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts",
    "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu",
    "я": "ya",
    # Ukrainian and Belarusian letters outside the Russian alphabet
    "і": "i", "ї": "i", "є": "ye", "ґ": "g", "ў": "u",
}
# Latin letters that do not fall apart into a base letter and an accent
_LATIN = {"ß": "ss", "æ": "ae", "ø": "o", "œ": "oe", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i"}


def transliterate(text: str) -> str:
    """Lowercase Latin form of text; characters with no Latin form are kept as they are."""
    out = []
    for char in text.lower():
        if char in _CYRILLIC:
            out.append(_CYRILLIC[char])
        elif char in _LATIN:
            out.append(_LATIN[char])
        else:
            out.append("".join(c for c in unicodedata.normalize("NFKD", char) if not unicodedata.combining(c)))
    return "".join(out)


def _cut(handle: str, length: int) -> str:
    return handle[:length].rstrip(_SEPARATORS)


def base_handle(name: str, fmt: str = DEFAULT_FORMAT) -> str:
    """The handle a name gives in a format, before it is made unique.
    First name is the first word, last name the last; the words in between are left out."""
    if fmt not in HANDLE_FORMATS:
        raise ValueError(f"format must be one of {', '.join(HANDLE_FORMATS)}")
    words = [re.sub(r"[^a-z0-9]", "", word) for word in transliterate(name).split()]
    words = [word for word in words if word]
    if not words:
        return FALLBACK
    if len(words) == 1:
        return _cut(words[0], MAX_LENGTH)
    first, last = words[0], words[-1]
    handle = {
        "first.last": f"{first}.{last}",
        "f.last": f"{first[0]}.{last}",
        "first.l": f"{first}.{last[0]}",
    }[fmt]
    return _cut(handle, MAX_LENGTH)


def unique_handle(base: str, taken: set[str]) -> str:
    """base, or base with the smallest free number from 2 when base is taken (case ignored)."""
    taken = {handle.lower() for handle in taken}
    if base not in taken:
        return base
    number = 2
    while True:
        suffix = str(number)
        candidate = _cut(base, MAX_LENGTH - len(suffix)) + suffix
        if candidate not in taken:
            return candidate
        number += 1


def normalize_handle(text: str) -> str:
    """What the user typed, as a handle is stored: no spaces around, no leading @, lowercase."""
    return text.strip().lstrip("@").strip().lower()


def is_valid_handle(handle: str) -> bool:
    return bool(_VALID.match(handle))
