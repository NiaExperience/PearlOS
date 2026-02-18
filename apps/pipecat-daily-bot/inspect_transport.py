from loguru import logger as _logger


logger = _logger.bind(module="inspect_transport")


def main() -> int:
    try:
        from pipecat.transports.services.daily import DailyTransport
    except ImportError:
        logger.error("Could not import DailyTransport")
        return 1

    logger.info("DailyTransport attributes: %s" % dir(DailyTransport))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
