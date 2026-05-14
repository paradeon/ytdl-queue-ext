#!/usr/bin/env python3
"""
Native messaging host for the yt-dlp Queue browser extension.
Receives a JSON message, writes the file to the specified queue directory.

Protocol: each message is a 4-byte little-endian length prefix followed by JSON bytes.
"""
import json
import os
import struct
import sys


def read_message() -> dict:
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        sys.exit(0)
    length = struct.unpack('<I', raw_len)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data)


def write_message(msg: dict) -> None:
    data = json.dumps(msg).encode()
    sys.stdout.buffer.write(struct.pack('<I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def main():
    try:
        msg = read_message()
        action = msg.get('action')

        if action == 'write':
            queue_dir = os.path.expanduser(msg['dir'])
            os.makedirs(queue_dir, exist_ok=True)
            written = []
            for entry in (msg.get('files') or [{'filename': msg['filename'], 'content': msg['content']}]):
                filename = os.path.basename(entry['filename'])  # no path traversal
                dest = os.path.join(queue_dir, filename)
                with open(dest, 'w', encoding='utf-8') as f:
                    f.write(entry['content'])
                written.append(dest)
            write_message({'ok': True, 'paths': written})

        elif action == 'append':
            log_path = os.path.expanduser(msg['path'])
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            with open(log_path, 'a', encoding='utf-8') as f:
                f.write(msg['line'] + '\n')
            write_message({'ok': True})

        else:
            write_message({'error': f"Unknown action: {action}"})

    except Exception as e:
        write_message({'error': str(e)})


if __name__ == '__main__':
    main()
