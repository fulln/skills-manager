#!/usr/bin/env python3
"""Read-only snapshot of skill records/content; never copy targets, settings or secrets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile


def snapshot(source: Path, destination: Path):
    source, destination = source.resolve(), destination.resolve()
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError('Source and destination must be separate directories')
    if destination.exists():
        raise ValueError('Destination already exists; refusing to overwrite development data')
    source_db = source / 'skills-manager.db'
    before = hashlib.sha256(source_db.read_bytes()).hexdigest()
    # Open only a private byte-for-byte copy. Even SQLite mode=ro can create
    # shared-memory sidecars beside a WAL database, which is forbidden here.
    source_copy = tempfile.TemporaryDirectory(prefix='skill-source-read-')
    private_db = Path(source_copy.name) / 'source.db'
    for suffix in ('', '-wal'):
        original = Path(str(source_db) + suffix)
        if original.exists():
            raw = original.read_bytes()
            Path(str(private_db) + suffix).write_bytes(raw)
            if raw != original.read_bytes():
                source_copy.cleanup()
                raise ValueError('Source database changed during snapshot; retry later')
    connection = sqlite3.connect(private_db)
    connection.row_factory = sqlite3.Row
    staging = None
    try:
        connection.execute('BEGIN')
        records = [dict(row) for row in connection.execute('SELECT * FROM skills')]
        tags = list(connection.execute('SELECT skill_id, tag FROM skill_tags'))
        schema = connection.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='skills'").fetchone()[0]
        destination.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix='.skill-snapshot-', dir=destination.parent))
        (staging / 'skills').mkdir()
        with sqlite3.connect(staging / 'skills-manager.db') as target:
            target.execute(schema)
            target.execute('CREATE TABLE skill_tags (skill_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(skill_id, tag))')
            for record in records:
                original = Path(record['central_path']).resolve(strict=True)
                if not original.is_dir() or not (original / 'SKILL.md').is_file():
                    raise ValueError('A source skill is missing its directory or SKILL.md')
                # UUID IDs are opaque; never allow an ID to become a path traversal.
                identifier = record['id']
                if not identifier or Path(identifier).name != identifier or identifier in ('.', '..'):
                    raise ValueError('Invalid skill ID')
                copied = staging / 'skills' / identifier
                # Keep all copied data independent; external symlinks could cause live writes.
                # Reject links rather than silently copying linked credentials/large trees.
                for root, directories, files in os.walk(original, followlinks=False):
                    if any((Path(root) / name).is_symlink() for name in directories + files):
                        raise ValueError(f'Skill {record["name"]} contains symlinks; requires a reviewed copy')
                shutil.copytree(original, copied, ignore=shutil.ignore_patterns('.git', '.worktrees', '__pycache__', 'node_modules', '.venv', '.env', '.env.*'))
                final_path = str(destination / 'skills' / identifier)
                record['central_path'] = final_path
                if record['source_type'] in ('local', 'import'):
                    record['source_ref'] = final_path
                    record['source_ref_resolved'] = None
                record['content_hash'] = None
                columns = list(record)
                target.execute('INSERT INTO skills (' + ','.join('"' + c + '"' for c in columns) + ') VALUES (' + ','.join('?' for _ in columns) + ')', [record[c] for c in columns])
            target.executemany('INSERT INTO skill_tags VALUES (?, ?)', [tuple(row) for row in tags])
        manifest = {'skills': len(records), 'mode': 'independent-content-copy', 'excluded': ['deployments', 'settings', 'credentials', 'backup-remotes', 'presets', 'projects'], 'source_database_unchanged': before == hashlib.sha256(source_db.read_bytes()).hexdigest()}
        (staging / 'snapshot-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
        # Refuse concurrent destination creation rather than replacing existing state.
        if destination.exists():
            raise ValueError('Destination appeared during snapshot; refusing overwrite')
        staging.rename(destination)
        staging = None
        return manifest
    finally:
        connection.close()
        source_copy.cleanup()
        if staging is not None:
            shutil.rmtree(staging)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(snapshot(args.source, args.destination), ensure_ascii=False, indent=2))
