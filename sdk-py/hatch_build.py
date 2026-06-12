# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Build hook: bundle the cards corpus and schema into the package.

When building from the repo, copy ``../cards`` and ``../schema`` into
``artano_lemma/_corpus`` and ``artano_lemma/_schema`` so the wheel and sdist
are self-contained. When building a wheel from an sdist (where those copies
already exist and the repo siblings do not), do nothing.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CardsBundleHook(BuildHookInterface):
    PLUGIN_NAME = "custom"

    def initialize(self, version, build_data):
        root = Path(self.root)
        pkg = root / "artano_lemma"
        for src_name, dest_name in (("cards", "_corpus"), ("schema", "_schema")):
            src = root.parent / src_name
            if not src.exists():
                continue  # building from an sdist — already bundled
            dest = pkg / dest_name
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(src, dest)
