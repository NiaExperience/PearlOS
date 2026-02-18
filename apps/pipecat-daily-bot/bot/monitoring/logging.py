import logging
import os
import sys
import threading
from loguru import logger

def _resolve_log_level():
    raw = (os.getenv('DEBUG_BOT') or '').strip().lower()
    return 'DEBUG' if raw in ('1', 'true', 'yes', 'on') else 'INFO'

def configure_logging():
    """Configure logging with dynamic level and filters."""
    try:
        logger.remove()  # remove all sinks
    except Exception:
        pass
    # Re-add sink with dynamic level
    logger.add(sys.stderr, level=_resolve_log_level())
    _configure_logging_filters()
    _install_fd_muter()

def set_debug_mode(enabled: bool):  # optional runtime toggle
    try:
        logger.remove()
    except Exception:
        pass
    os.environ['DEBUG_BOT'] = 'true' if enabled else 'false'
    logger.add(sys.stderr, level=_resolve_log_level())

class LibWebRTCMuteFilter(logging.Filter):
    """Filter out noisy libwebrtc::* lines from logs when enabled via env.

    Controlled by env var MUTE_LIBWEBRTC_LOGS (or BOT_MUTE_LIBWEBRTC_LOGS)
    accepting 1/true/yes/on. Default disabled.
    """

    def __init__(self, enabled: bool):
        super().__init__()
        self.enabled = enabled

    def filter(self, record: logging.LogRecord) -> bool:  # type: ignore[override]
        if not self.enabled:
            return True
        try:
            msg = str(record.getMessage())
            if 'libwebrtc::' in msg:
                return False
        except Exception:
            return True
        return True

def _configure_logging_filters():
    raw = os.getenv('MUTE_LIBWEBRTC_LOGS') or os.getenv('BOT_MUTE_LIBWEBRTC_LOGS') or ''
    enabled = raw.strip().lower() in ('1', 'true', 'yes', 'on')
    if not enabled:
        return
    filt = LibWebRTCMuteFilter(enabled=True)
    # Attach to root logging and uvicorn-like loggers if present
    for name in ('', 'uvicorn', 'uvicorn.error', 'uvicorn.access'):
        try:
            pylogger = logging.getLogger(name)
            pylogger.addFilter(filt)
        except Exception:
            pass

# Low-level FD filter to drop libwebrtc noisy lines coming from native libs
def _env_bool_default_true(primary: str, fallback: str | None = None) -> bool:
    raw = os.getenv(primary)
    if raw is None and fallback:
        raw = os.getenv(fallback)
    if raw is None:
        return True  # default: enabled
    v = raw.strip().lower()
    if v in ('0', 'false', 'no', 'off'):
        return False
    return True

def _install_fd_muter(pattern: bytes = b'libwebrtc::'):
    # Avoid interfering with pytest capture
    if os.getenv('PYTEST_CURRENT_TEST'):
        return
    enabled = _env_bool_default_true('MUTE_LIBWEBRTC_LOGS', 'BOT_MUTE_LIBWEBRTC_LOGS')
    if not enabled:
        return

    def _wrap_fd(fd: int):
        try:
            orig_fd = os.dup(fd)
            r, w = os.pipe()
            # Redirect writes on fd to our pipe writer
            os.dup2(w, fd)
            os.close(w)

            def _reader():
                buf = b''
                try:
                    while True:
                        try:
                            chunk = os.read(r, 4096)
                        except OSError:
                            break
                        if not chunk:
                            break
                        buf += chunk
                        while b'\n' in buf:
                            line, buf = buf.split(b'\n', 1)
                            try:
                                if pattern in line:
                                    # drop
                                    continue
                                os.write(orig_fd, line + b'\n')
                            except Exception:
                                # best-effort
                                pass
                    # flush remainder without newline
                    if buf:
                        try:
                            if pattern not in buf:
                                os.write(orig_fd, buf)
                        except Exception:
                            pass
                finally:
                    try:
                        os.close(r)
                    except Exception:
                        pass

            t = threading.Thread(target=_reader, name=f'fd-muter-{fd}', daemon=True)
            t.start()
        except Exception:
            # If anything fails, do not disrupt normal stdout/stderr
            try:
                os.close(r)
            except Exception:
                pass
            return

    # Apply to stdout (1) and stderr (2)
    _wrap_fd(1)
    _wrap_fd(2)
