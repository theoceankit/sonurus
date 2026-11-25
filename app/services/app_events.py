"""What changed in the app's data, for whoever follows it: WS /ws/events passes
each event on to the UI. Services publish from whichever thread made the change.

Services are made per request, so the bus is one for the process: `app_events`.
Today the only event is note_changed, sent by TranscriptStorageService."""
import threading

from app.logger import get_logger

log = get_logger("Events")


class AppEvents:
    def __init__(self):
        self._lock = threading.Lock()
        self._subscribers: list = []

    def subscribe(self, callback):
        """callback(event) gets every event published from now on. Returns the
        function that stops it; calling that again does nothing."""
        with self._lock:
            self._subscribers.append(callback)

        def unsubscribe():
            with self._lock:
                if callback in self._subscribers:
                    self._subscribers.remove(callback)
        return unsubscribe

    def publish(self, event: dict) -> None:
        """Callbacks run in the publisher's thread and must be quick. One that
        fails is logged and the others still hear the event."""
        with self._lock:
            subscribers = list(self._subscribers)
        for callback in subscribers:
            try:
                callback(event)
            except Exception as exc:
                log.warning(f"Event subscriber failed: {exc}")


app_events = AppEvents()
