"""AMI Meeting Corpus manual annotations (CC BY 4.0): word timings per
participant (words/<meeting>.<agent>.words.xml) and who sat on which headset
channel (corpusResources/meetings.xml)."""
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import numpy as np

NITE = "{http://nite.sourceforge.net/}"


@dataclass(frozen=True)
class Speaker:
    agent: str        # A–D, the letter in the words file name
    channel: int      # headset channel: <meeting>.Headset-<channel>.wav
    global_name: str  # the same person across meetings, e.g. FEE005


def parse_words(xml: bytes) -> list[tuple[float, float, str]]:
    """(start, end, word) of timed words; punctuation and non-word events left out."""
    out = []
    for el in ET.fromstring(xml).iter("w"):
        if el.get("punc") == "true" or el.get("starttime") is None or el.get("endtime") is None:
            continue
        out.append((float(el.get("starttime")), float(el.get("endtime")), el.text or ""))
    return out


def parse_meeting_speakers(xml: bytes, meeting: str) -> dict[str, Speaker]:
    for m in ET.fromstring(xml).iter("meeting"):
        if m.get("observation") == meeting:
            return {
                s.get("nxt_agent"): Speaker(s.get("nxt_agent"), int(s.get("channel")), s.get("global_name"))
                for s in m.iter("speaker")
            }
    raise KeyError(f"meeting {meeting} not in meetings.xml")


def window_reference(words_by_agent, speakers, start: float, end: float) -> list[dict]:
    """Reference words fully inside [start, end), times relative to start, in time order."""
    ref = [
        {"word": w, "start": round(s - start, 3), "end": round(e - start, 3), "speaker": speakers[agent].global_name}
        for agent, words in words_by_agent.items()
        for s, e, w in words
        if s >= start and e <= end
    ]
    return sorted(ref, key=lambda r: (r["start"], r["end"]))


def speech_gate(n: int, intervals, sample_rate: int, pad: float = 0.25, fade: float = 0.02) -> np.ndarray:
    """Gain 0…1 per sample: open on the intervals widened by pad, closed elsewhere,
    with linear fades of `fade` seconds outside the open parts.

    Applied to a headset track it keeps its owner's speech and drops what the
    microphone picked up from the others in the room.
    """
    gate = np.zeros(n)
    for s, e in intervals:
        gate[max(0, int((s - pad) * sample_rate)):min(n, int((e + pad) * sample_rate))] = 1.0
    k = max(1, int(fade * sample_rate))
    ramp = np.linspace(0, 1, k + 2)[1:-1]
    edges = np.diff(np.concatenate([[0.0], gate, [0.0]]))
    for i in np.flatnonzero(edges > 0):          # rising edge at sample i
        lo = max(0, i - k)
        gate[lo:i] = np.maximum(gate[lo:i], ramp[k - (i - lo):])
    for i in np.flatnonzero(edges < 0):          # falling edge: closed from sample i
        hi = min(n, i + k)
        gate[i:hi] = np.maximum(gate[i:hi], ramp[::-1][:hi - i])
    return gate
