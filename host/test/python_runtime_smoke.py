import asyncio
import json
import sys
import urllib.request
import base64
import tempfile
import time
import ssl
from pathlib import Path

import websockets

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aether_server import (
    MAX_BASE64_CHUNK_CHARS,
    AetherServerBackend,
    CommunicationSignals,
    calculate_hardware_pin,
    encode_universal_9_code,
    validate_client_message,
)

assert validate_client_message({"action": "FILE_CHUNK", "data": "A" * MAX_BASE64_CHUNK_CHARS})
assert not validate_client_message({"action": "FILE_CHUNK", "data": "A" * (MAX_BASE64_CHUNK_CHARS + 1)})
assert validate_client_message({"action": "DECK_SLIDER", "triggerId": "slider-1"})
assert not validate_client_message({"action": "DECK_SLIDER"})
assert not validate_client_message({"action": "DECK_SLIDER", "triggerId": ""})
assert not validate_client_message({"action": "DECK_SLIDER", "triggerId": 42})

pairing_secrets = {calculate_hardware_pin("same-host") for _ in range(32)}
assert len(pairing_secrets) > 1
assert all(len(secret) == 6 and secret.isdigit() for secret in pairing_secrets)
pairing_code, formatted_pairing_code = encode_universal_9_code("192.168.1.42", "000001")
assert pairing_code == "001042000001"
assert formatted_pairing_code == "001 - 042 - 000001"


async def run():
    port = 18080
    with tempfile.TemporaryDirectory(prefix="aether-python-smoke-") as download_directory:
        backend = AetherServerBackend(CommunicationSignals(), port=port, download_directory=download_directory, enable_discovery=False, tls_directory=str(Path(download_directory) / "tls"))
        token = "test-session-token"
        now = int(time.time() * 1000)
        backend.tokens_file_path = str(Path(download_directory) / "tokens.json")
        backend.authenticated_tokens[token] = {"issuedAt": now, "expiresAt": now + 60_000, "deviceName": "Test phone"}
        server_task = asyncio.create_task(backend.start_server())
        try:
            await asyncio.sleep(1)
            tls_context = ssl._create_unverified_context()
            response = await asyncio.to_thread(urllib.request.urlopen, f"https://127.0.0.1:{port}/health", context=tls_context)
            health = json.loads(response.read().decode("utf-8"))
            assert health["status"] == "ok"
            assert health["protocolVersion"] == "2.0"
            assert health["secure"] is True
            assert health["tlsFingerprint"] == backend.tls_fingerprint
            assert "host" not in health
            assert "mac" not in health

            async with websockets.connect(
                f"wss://127.0.0.1:{port}",
                ssl=tls_context,
                origin="https://untrusted.example",
            ) as blocked_socket:
                blocked = json.loads(await blocked_socket.recv())
                assert blocked["status"] == "AUTH_BLOCKED"
            await asyncio.sleep(0.05)
            assert not backend.all_websockets

            async def approve_next_pairing_request():
                for _ in range(100):
                    if backend.pending_requests:
                        request_id = next(iter(backend.pending_requests))
                        backend.resolve_pending_request(request_id, True)
                        return
                    await asyncio.sleep(0.01)
                raise AssertionError("Pairing request was not registered")

            pairing_code, _ = encode_universal_9_code(backend.local_ip, backend.hardware_pin)
            async with websockets.connect(f"wss://127.0.0.1:{port}", ssl=tls_context) as pairing_socket:
                approval_task = asyncio.create_task(approve_next_pairing_request())
                await pairing_socket.send(json.dumps({"action": "AUTH", "pin": pairing_code, "deviceModel": "Fresh phone"}))
                assert json.loads(await pairing_socket.recv())["status"] == "AUTH_PENDING"
                paired = json.loads(await pairing_socket.recv())
                await approval_task
                assert paired["status"] == "AUTH_OK"
                assert paired["sessionToken"] in backend.authenticated_tokens

            async with websockets.connect(f"wss://127.0.0.1:{port}", ssl=tls_context) as socket:
                timestamp = 123456789
                await socket.send(json.dumps({"action": "PING", "timestamp": timestamp}))
                unauthorized = json.loads(await socket.recv())
                assert unauthorized["status"] == "UNAUTHORIZED"

                await socket.send(json.dumps({"action": "AUTH", "sessionToken": token, "deviceModel": "Pixel Test"}))
                authenticated = json.loads(await socket.recv())
                assert authenticated["status"] == "AUTH_OK"
                assert authenticated["protocolVersion"] == "2.0"
                assert authenticated["tlsFingerprint"] == backend.tls_fingerprint

                await socket.send(json.dumps({"action": "PING", "timestamp": timestamp}))
                pong = json.loads(await socket.recv())
                assert pong["action"] == "PONG"
                assert pong["timestamp"] == timestamp

                await socket.send(json.dumps({"action": "FILE_START", "fileId": "cancel-file", "fileName": "cancel.txt", "fileSize": 4}))
                assert json.loads(await socket.recv())["status"] == "SUCCESS"
                await socket.send(json.dumps({"action": "FILE_CANCEL", "fileId": "cancel-file"}))
                cancel_ack = json.loads(await socket.recv())
                assert cancel_ack == {"action": "FILE_CANCEL_ACK", "fileId": "cancel-file", "status": "SUCCESS"}
                assert "cancel-file" not in backend.active_file_transfers
                assert not (Path(download_directory) / "cancel.txt").exists()

                protected_payload = b"owner only"
                await socket.send(json.dumps({"action": "FILE_START", "fileId": "protected-file", "fileName": "protected.txt", "fileSize": len(protected_payload)}))
                assert json.loads(await socket.recv())["status"] == "SUCCESS"
                async with websockets.connect(f"wss://127.0.0.1:{port}", ssl=tls_context) as second_socket:
                    await second_socket.send(json.dumps({"action": "AUTH", "sessionToken": token, "deviceModel": "Second phone"}))
                    assert json.loads(await second_socket.recv())["status"] == "AUTH_OK"
                    await second_socket.send(json.dumps({"action": "FILE_END", "fileId": "protected-file"}))
                    rejected_end = json.loads(await second_socket.recv())
                    assert rejected_end["action"] == "FILE_END_ACK"
                    assert rejected_end["status"] == "ERROR"
                    assert "protected-file" in backend.active_file_transfers
                await socket.send(json.dumps({"action": "FILE_CHUNK", "fileId": "protected-file", "offset": 0, "data": base64.b64encode(protected_payload).decode("ascii")}))
                assert json.loads(await socket.recv())["status"] == "SUCCESS"
                await socket.send(json.dumps({"action": "FILE_END", "fileId": "protected-file"}))
                assert json.loads(await socket.recv())["status"] == "SUCCESS"
                assert (Path(download_directory) / "protected.txt").read_bytes() == protected_payload

                payload = b"hello aether"
                await socket.send(json.dumps({"action": "FILE_START", "fileId": "smoke-file", "fileName": "smoke.txt", "fileSize": len(payload)}))
                assert json.loads(await socket.recv())["status"] == "SUCCESS"
                await socket.send(json.dumps({"action": "FILE_CHUNK", "fileId": "smoke-file", "offset": 0, "data": base64.b64encode(payload).decode("ascii")}))
                chunk_ack = json.loads(await socket.recv())
                assert chunk_ack["action"] == "FILE_CHUNK_ACK"
                assert chunk_ack["status"] == "SUCCESS"
                assert chunk_ack["receivedBytes"] == len(payload)
                await socket.send(json.dumps({"action": "FILE_END", "fileId": "smoke-file"}))
                assert json.loads(await socket.recv())["status"] == "SUCCESS"
                assert (Path(download_directory) / "smoke.txt").read_bytes() == payload
        finally:
            server_task.cancel()
            try:
                await server_task
            except asyncio.CancelledError:
                pass


asyncio.run(run())
print("Python runtime smoke tests passed.")
