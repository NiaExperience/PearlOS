"""MSAM CLI Tests -- command dispatch, help, grep, export/import."""

import sys
import os
import json
import tempfile

import pytest



class TestHelp:
    def test_help_runs(self, capsys):
        from msam.remember import cmd_help
        cmd_help()
        captured = capsys.readouterr()
        assert "MSAM CLI" in captured.out
        assert "Storage:" in captured.out
        assert "Retrieval:" in captured.out
        assert "grep" in captured.out
        assert "export" in captured.out


class TestGrep:
    def test_grep_no_args(self, capsys):
        from msam.remember import cmd_grep
        cmd_grep([])
        captured = capsys.readouterr()
        assert "Usage" in captured.out

    def test_grep_finds_content(self, capsys, monkeypatch, tmp_path):
        # Set up temp db
        db_path = tmp_path / "test.db"
        monkeypatch.setattr("msam.core.DB_PATH", db_path)
        
        import numpy as np
        fake_emb = list(np.random.randn(1024).astype(float))
        monkeypatch.setattr("msam.core.embed_text", lambda t: fake_emb)
        
        from msam.core import store_atom
        store_atom("Unique findable content xyz123")
        
        from msam.remember import cmd_grep
        cmd_grep(["xyz123"])
        captured = capsys.readouterr()
        data = json.loads(captured.out)
        assert data["count"] >= 1


class TestExportImport:
    def test_export_creates_file(self, capsys, monkeypatch, tmp_path):
        db_path = tmp_path / "test.db"
        monkeypatch.setattr("msam.core.DB_PATH", db_path)
        
        import numpy as np
        fake_emb = list(np.random.randn(1024).astype(float))
        monkeypatch.setattr("msam.core.embed_text", lambda t: fake_emb)
        
        from msam.core import store_atom
        store_atom("Export test atom")
        
        export_file = str(tmp_path / "export.jsonl")
        from msam.remember import cmd_export
        cmd_export([export_file])
        
        captured = capsys.readouterr()
        data = json.loads(captured.out)
        assert data["exported"] >= 1
        assert os.path.exists(export_file)
        
        # Verify JSONL format
        with open(export_file) as f:
            lines = f.readlines()
        assert len(lines) >= 1
        atom = json.loads(lines[0])
        assert "content" in atom
        assert "stream" in atom

    def test_import_from_jsonl(self, capsys, monkeypatch, tmp_path):
        db_path = tmp_path / "test_import.db"
        monkeypatch.setattr("msam.core.DB_PATH", db_path)
        
        import numpy as np
        fake_emb = list(np.random.randn(1024).astype(float))
        monkeypatch.setattr("msam.core.embed_text", lambda t: fake_emb)
        
        # Create a JSONL file
        import_file = str(tmp_path / "import.jsonl")
        with open(import_file, 'w') as f:
            f.write(json.dumps({"content": "Imported atom one", "stream": "semantic"}) + "\n")
            f.write(json.dumps({"content": "Imported atom two", "stream": "episodic"}) + "\n")
        
        from msam.remember import cmd_import
        cmd_import([import_file])
        
        captured = capsys.readouterr()
        data = json.loads(captured.out)
        assert data["imported"] == 2
        assert data["failed"] == 0
