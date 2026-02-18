import eventbus


def test_event_constants_exist():
    # Ensure constants are exported (backwards compatibility + refactor safety)
    assert eventbus.EVENT_SCHEMA_VERSION == "1"
    for name in [
        "DAILY_CALL_STATE",
        "DAILY_PARTICIPANT_FIRST_JOIN",
        "DAILY_PARTICIPANT_JOIN",
        "DAILY_PARTICIPANT_LEAVE",
        "DAILY_PARTICIPANTS_CHANGE",
        "BOT_SESSION_END",
        "BOT_SPEAKING_STARTED",
        "BOT_SPEAKING_STOPPED",
    ]:
        assert hasattr(eventbus, name), f"Missing constant: {name}"


def test_envelope_structure_and_publish():
    env = eventbus.publish("unit.test.topic", {"k": 1})
    assert env["version"] == eventbus.EVENT_SCHEMA_VERSION
    assert env["type"] == "unit.test.topic"
    assert set(["id", "ts", "type", "version", "data"]).issubset(env.keys())
    assert env["data"] == {"k": 1}
