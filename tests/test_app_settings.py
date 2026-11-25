"""Settings the backend keeps for itself (app_settings table): read once,
then answered from memory; Settings → Data → Reset brings them back to a new
installation's."""
import sqlite3

from app.services.app_settings import AppSettings, MCP_ENABLED


def test_a_new_installation_has_the_mcp_server_off(tmp_path):
    assert AppSettings(str(tmp_path / "db.sqlite")).get_bool(MCP_ENABLED) is False


def test_a_setting_is_kept_in_the_database(tmp_path):
    db = str(tmp_path / "db.sqlite")
    AppSettings(db).set_bool(MCP_ENABLED, True)
    assert AppSettings(db).get_bool(MCP_ENABLED) is True
    AppSettings(db).set_bool(MCP_ENABLED, False)
    assert AppSettings(db).get_bool(MCP_ENABLED) is False


def test_a_read_does_not_go_to_the_database(tmp_path):
    db = str(tmp_path / "db.sqlite")
    settings = AppSettings(db)
    settings.set_bool(MCP_ENABLED, True)
    with sqlite3.connect(db) as conn:
        conn.execute("DROP TABLE app_settings")
    assert settings.get_bool(MCP_ENABLED) is True


def test_clear_brings_back_the_defaults(tmp_path):
    db = str(tmp_path / "db.sqlite")
    settings = AppSettings(db)
    settings.set_bool(MCP_ENABLED, True)
    settings.clear()
    assert settings.get_bool(MCP_ENABLED) is False
    assert AppSettings(db).get_bool(MCP_ENABLED) is False


def test_the_table_lives_next_to_the_other_data(tmp_path):
    db = str(tmp_path / "db.sqlite")
    AppSettings(db).set_bool(MCP_ENABLED, True)
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT value FROM app_settings WHERE key = ?", (MCP_ENABLED,)).fetchone() == ("1",)
