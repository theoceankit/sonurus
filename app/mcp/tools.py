"""What the MCP tools answer, as text for an agent: recordings by
recording_id, times as mm:ss or h:mm:ss, dates as YYYY-MM-DD in local time.
No MCP imports here, so the formats are tested on their own."""


def clock(seconds: float) -> str:
    """A time in a recording: mm:ss under an hour, h:mm:ss from an hour on."""
    total = int(seconds)
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"


def format_recordings(rows: list[dict]) -> str:
    """rows: TranscriptStorageService.list_all(), newest first."""
    if not rows:
        return "No recordings yet. Transcribe or record audio in Sonorus first."
    lines = [f"{len(rows)} recording{'' if len(rows) == 1 else 's'}, newest first:"]
    for row in rows:
        date = (row.get("created_at") or "")[:10] or "unknown date"
        lines.append(f"- recording_id {row['id']}: {row['title']}, {date}, {clock(row.get('duration_sec') or 0)}")
    return "\n".join(lines)
