from __future__ import annotations

import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))

import download_slakh_subset  # noqa: E402


class SlakhSubsetDownloadTests(unittest.TestCase):
    def test_budget_is_checked_before_any_file_download(self):
        files = [{"type": "file", "path": "data/Slakh2100_redux/train/Track00018/mix.flac", "size": 90}]
        with tempfile.TemporaryDirectory() as directory, patch.object(download_slakh_subset, "tree", return_value=files), patch.object(download_slakh_subset, "request_bytes") as request:
            with self.assertRaisesRegex(RuntimeError, "budget"):
                download_slakh_subset.download_tracks(Path(directory), ("Track00018",), 80)
        request.assert_not_called()

    def test_complete_subset_writes_a_reproducible_manifest(self):
        files = [{"type": "file", "path": "data/Slakh2100_redux/train/Track00018/metadata.yaml", "size": 4}]
        with tempfile.TemporaryDirectory() as directory, patch.object(download_slakh_subset, "tree", return_value=files), patch.object(download_slakh_subset, "request_bytes", return_value=b"data"):
            root = Path(directory)
            manifest = download_slakh_subset.download_tracks(root, ("Track00018",), 100)
            self.assertEqual(manifest["bytes"], 4)
            self.assertEqual((root / "Track00018" / "metadata.yaml").read_bytes(), b"data")
            self.assertTrue((root / "subset-manifest.json").is_file())


if __name__ == "__main__":
    unittest.main()
