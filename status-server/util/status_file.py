#!/usr/bin/env python3
from pathlib import Path

# Creates an empty status file
def create_empty(status_file_path):
    Path(status_file_path).open('w').close()

# Retuns the index of the dict with a matching ID from a list
def _get_index(list, id):
    for i, dict in enumerate(list):
        if dict['id'] == id:
            return i
    return None

# Parses a status file
def parse(status_file_path):
    # Empty list for holding the status entries
    statuses = []
    # Read the status file and loop over the entries
    for entry in Path(status_file_path).read_text().split():
        # Decode parts with ":" seperator
        parts = entry.split(':')
        parsed_entry = {
            'id': parts[0],
            'status': parts[1],
            'error': parts[2] if len(parts) >2 else None
        }
        # Check if we already have an entry for this id
        index = _get_index(statuses, parsed_entry['id'])
        # If we don't, append the entry
        if index == None:
            statuses.append(parsed_entry)
        # If we do, update the entry
        else:
            statuses[index] = parsed_entry
    return statuses

# Checks if a status file contains errors
def contains_errors(status_file_path):
    status = parse(status_file_path)
    for entry in status:
        if entry['status'] == 'errored':
            return True
    return False
