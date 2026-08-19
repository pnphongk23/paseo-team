#!/usr/bin/env python3
"""Tests for agy-acp-paseo.py model cache refresh."""

from __future__ import annotations

import json
import os
import stat
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock


import importlib.util

SCRIPTS_DIR = Path(__file__).parent.resolve()
_SPEC = importlib.util.spec_from_file_location(
    "agy_acp_paseo",
    SCRIPTS_DIR / "agy-acp-paseo.py",
)
assert _SPEC and _SPEC.loader
wrapper = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(wrapper)


class TestParseAgyModels(unittest.TestCase):
    def test_skips_fetching_header_and_parses_tsv(self) -> None:
        stdout = (
            "Fetching available models...\n"
            "gemini-3.7-flash-high\tGemini 3.7 Flash (High)\n"
            "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n"
        )
        models = wrapper.parse_agy_models_stdout(stdout)
        self.assertEqual(
            models,
            [
                {"value": "gemini-3.7-flash-high", "name": "Gemini 3.7 Flash (High)"},
                {"value": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6 (Thinking)"},
            ],
        )

    def test_dedupes_and_ignores_blank(self) -> None:
        stdout = "\nfoo\tFoo\nfoo\tFoo again\n"
        models = wrapper.parse_agy_models_stdout(stdout)
        self.assertEqual(models, [{"value": "foo", "name": "Foo"}])


class TestCacheUsable(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="agy-acp-paseo-")
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_empty_list_is_unusable(self) -> None:
        path = self.root / "models.json"
        path.write_text("[]\n")
        self.assertFalse(wrapper.cache_is_usable(path, ttl_seconds=3600))

    def test_fresh_cache_is_usable(self) -> None:
        path = self.root / "models.json"
        path.write_text(json.dumps([{"value": "m", "name": "M"}]) + "\n")
        self.assertTrue(wrapper.cache_is_usable(path, ttl_seconds=3600))

    def test_stale_cache_is_unusable(self) -> None:
        path = self.root / "models.json"
        path.write_text(json.dumps([{"value": "m", "name": "M"}]) + "\n")
        old = time.time() - 10
        os.utime(path, (old, old))
        self.assertFalse(wrapper.cache_is_usable(path, ttl_seconds=5, now=time.time()))


class TestRefresh(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="agy-acp-paseo-")
        self.root = Path(self.temp.name)
        self.agy = self.root / "agy"
        self.agy.write_text(
            "#!/bin/sh\n"
            "printf 'gemini-new\\tGemini New\\n'\n"
        )
        self.agy.chmod(self.agy.stat().st_mode | stat.S_IEXEC)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_refresh_writes_atomic_cache(self) -> None:
        cache = self.root / "models.json"
        models = wrapper.refresh_models_cache(agy_bin=self.agy, cache_file=cache)
        self.assertEqual(models, [{"value": "gemini-new", "name": "Gemini New"}])
        self.assertEqual(json.loads(cache.read_text()), models)

    def test_ensure_skips_refresh_when_fresh(self) -> None:
        cache = self.root / "models.json"
        cache.write_text(json.dumps([{"value": "old", "name": "Old"}]) + "\n")
        with mock.patch.object(wrapper, "refresh_models_cache") as refresh:
            wrapper.ensure_warm_cache(self.agy, cache, self.root / "models.lock", 3600)
            refresh.assert_not_called()

    def test_ensure_refreshes_when_stale(self) -> None:
        cache = self.root / "models.json"
        cache.write_text(json.dumps([{"value": "old", "name": "Old"}]) + "\n")
        old = time.time() - 100
        os.utime(cache, (old, old))
        wrapper.ensure_warm_cache(self.agy, cache, self.root / "models.lock", 10)
        self.assertEqual(
            json.loads(cache.read_text()),
            [{"value": "gemini-new", "name": "Gemini New"}],
        )


if __name__ == "__main__":
    unittest.main()
