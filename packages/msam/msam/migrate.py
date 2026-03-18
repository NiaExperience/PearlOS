#!/usr/bin/env python3
"""
MSAM Migration -- Convert markdown memory files into MSAM atoms.

This is a template. Customize the file paths and entity names for your deployment.

Usage:
    python msam/migrate.py [--dry-run]
"""

import sys
import os
import re
from pathlib import Path


from .core import store_atom
from .triples import extract_and_store
from .annotate import heuristic_annotate


def migrate_markdown_file(filepath: Path, entity: str, stream: str = "semantic"):
    """Migrate a single markdown file into atoms.
    
    Splits on headers (## or ###) and stores each section as an atom.
    Extracts triples from each atom for the knowledge graph.
    """
    if not filepath.exists():
        print(f"  SKIP: {filepath} (not found)")
        return 0
    
    content = filepath.read_text()
    sections = re.split(r'\n(?=##\s)', content)
    
    stored = 0
    for section in sections:
        section = section.strip()
        if not section or len(section) < 20:
            continue
        
        # Annotate
        annotations = heuristic_annotate(section)
        
        atom_id = store_atom(
            content=section,
            stream=stream,
            arousal=annotations.get("arousal", 0.5),
            valence=annotations.get("valence", 0.0),
            topics=annotations.get("topics", [entity.lower()]),
            source_type="external",
        )
        
        if atom_id:
            # Extract triples
            try:
                extract_and_store(atom_id, section)
            except Exception:
                pass
            stored += 1
    
    print(f"  {filepath.name}: {stored} atoms stored")
    return stored


def run_migration():
    """Run full migration. Customize these paths for your deployment."""
    # Example file list -- replace with your actual memory files
    files = [
        # (path, entity_name, stream)
        # ("memory/people/user.md", "User", "semantic"),
        # ("memory/projects/project.md", "Project", "semantic"),
        # ("memory/context/opinions.md", "Agent", "semantic"),
    ]
    
    if not files:
        print("No files configured for migration.")
        print("Edit msam/migrate.py and add your file paths to the 'files' list.")
        return
    
    total = 0
    for filepath, entity, *rest in files:
        stream = rest[0] if rest else "semantic"
        total += migrate_markdown_file(Path(filepath), entity, stream)
    
    print(f"\nMigration complete: {total} atoms stored.")


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("DRY RUN -- no atoms will be stored")
    else:
        run_migration()
