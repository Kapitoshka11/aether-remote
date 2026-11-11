from pathlib import Path

SOURCE = (Path(__file__).parent.parent / "aether_server.py").read_text(encoding="utf-8")

required = (
    "async def stream_screen_loop",
    "asyncio.create_task(self.stream_screen_loop(websocket))",
    "screen_task.cancel()",
    "frame_sent_at_by_id",
    '"action": "STREAM_FRAME_META"',
    "inside_download_directory = os.path.commonpath((dl_dir, candidate_path)) == dl_dir",
    "except ValueError:",
    "hmac.compare_digest(provided_pin, pairing_code9)",
    'f_obj = open(candidate_path, "xb")',
    '"action": "DECK_UNAVAILABLE"',
    '"capabilities": ["file-transfer-v2", "binary-screen-v1", "binary-audio-pcm16-v1", "clipboard-history-v1"]',
    "async def clipboard_broadcast_loop",
    '"action": "CLIPBOARD_ITEM"',
    '"clipboard-history-v1" not in getattr(client, "aether_capabilities", set())',
    'CLIPBOARD_HISTORY_MAX_CHARS = 100_000',
    'self.last_clipboard_fingerprint = clipboard_fingerprint(str(new_text))',
    'MAX_BASE64_CHUNK_CHARS = 4 * ((256 * 1024 + 2) // 3)',
    '"action": "CLIPBOARD_TEXT"',
    's_cmd in ("WRITE_CLIPBOARD", "SET", "SET_CLIPBOARD")',
    'connection_transfer_count = sum(',
    'timeout_seconds = 10 if transfer',
)
for contract in required:
    assert contract in SOURCE, f"Missing Python-host contract: {contract}"

compile(SOURCE, "aether_server.py", "exec")
print("Python host source contract tests passed.")
