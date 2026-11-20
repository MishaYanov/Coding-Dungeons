"""Shared, explicit manuscript inventory for rendering and validation."""
from pathlib import Path

LAB_NAMES = ('lab_async', 'lab_dispatch', 'lab_schedules')


def checked_sources(directory: Path):
    return sorted(directory.glob('ch*.txt')) + [
        directory / f'{name}.txt' for name in LAB_NAMES
        if (directory / f'{name}.txt').is_file()
    ]
