"""Runs the transcription pipeline in a child process.

A thread cannot be stopped from outside: a cancelled job used to run until
the next progress checkpoint, and "Transcribing audio…" (Whisper, alignment
and diarization in one call) can take minutes. A child process is stopped at
once, on any step, and its GPU memory is freed when it exits.

The child only computes: it loads the models, runs the pipeline and sends
the Transcript back. Saving and committing speakers stay in the backend
process, so a stopped job never leaves anything in the database.

Messages from the child (over a Pipe):
    ("progress", step)
    ("done", transcript)
    ("alignment_missing", language)
    ("error", exception_type_name, message)
"""
import multiprocessing
import os

# ML modules (torch, whisperx, …) are imported inside the functions: the
# spawned child imports this module first, and warnings must be silenced
# before those libraries load.

# Tests patch create_controller in the backend process, which only works
# in-process, so conftest turns this off.
RUN_PIPELINE_IN_SUBPROCESS = True

_POLL_INTERVAL = 0.2  # seconds between cancel checks while the child is silent


class PipelineCancelled(Exception):
    pass


def _pipeline_worker(args: dict, conn) -> None:
    """Child-process entry point."""
    try:
        quiet = os.getenv("VERBOSE", "false").lower() != "true"
        if quiet:
            from app.warnings import suppress_ml_noise
            suppress_ml_noise("startup")
        from app.services import service_factory
        if quiet:
            # Again once the ML libraries are loaded: Lightning resets its
            # logger levels on import.
            suppress_ml_noise("thread")
        controller, _ = service_factory.create_controller(db_path=args["db_path"], whisper_model=args["whisper_model"])
        transcript = controller.run_pipeline(
            args["audio_path"],
            on_progress=lambda step: conn.send(("progress", step)),
            language=args["language"],
        )
        conn.send(("done", transcript))
    except BaseException as exc:
        # Matched by name: the ML imports above are what may have failed.
        if type(exc).__name__ == "AlignmentModelMissingError":
            conn.send(("alignment_missing", exc.language))
        else:
            conn.send(("error", type(exc).__name__, str(exc)))


def _stop(proc) -> None:
    proc.terminate()
    proc.join(timeout=5)
    if proc.is_alive():
        proc.kill()
        proc.join()


def run_pipeline_process(args: dict, on_progress, cancel_event, worker=_pipeline_worker):
    """Run the pipeline in a child process and return its Transcript.

    args: audio_path, whisper_model, language, db_path (speaker memory, read
    only). Raises PipelineCancelled as soon as cancel_event is set, and
    AlignmentModelMissingError / RuntimeError for the child's errors. The
    child never outlives this call.
    """
    if cancel_event.is_set():
        raise PipelineCancelled()

    ctx = multiprocessing.get_context("spawn")
    recv_conn, send_conn = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=worker, args=(args, send_conn), daemon=True)
    proc.start()
    send_conn.close()
    result = None
    try:
        while result is None:
            if cancel_event.is_set():
                raise PipelineCancelled()
            if recv_conn.poll(_POLL_INTERVAL):
                try:
                    msg = recv_conn.recv()
                except EOFError:  # child died without reporting
                    break
                if msg[0] == "progress":
                    on_progress(msg[1])
                else:
                    result = msg
            elif not proc.is_alive() and not recv_conn.poll():
                break
    finally:
        if result is not None:
            proc.join(timeout=5)  # finished: let it exit on its own
        if proc.is_alive():
            _stop(proc)
        else:
            proc.join()
        recv_conn.close()

    if result is None:
        raise RuntimeError(f"Transcription process exited unexpectedly (code {proc.exitcode})")
    kind = result[0]
    if kind == "done":
        return result[1]
    if kind == "alignment_missing":
        from app.services.transcription_service import AlignmentModelMissingError
        raise AlignmentModelMissingError(result[1])
    raise RuntimeError(result[2] or result[1])
