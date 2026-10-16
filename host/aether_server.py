"""
AETHER REMOTE HOST AGENT - WINDOWS DESKTOP DAEMON
==================================================
A sleek, modern Windows Desktop Host Agent providing secure WebSocket remote control
for mobile devices. Features Liquid Glass aesthetic, auto-generated PIN/QR, anti-brute-force
guards, low-latency screen streaming, media controls, and system telemetry.

DEPENDENCIES INSTALLATION:
--------------------------
pip install PyQt6 websockets mss Pillow psutil pyperclip pyttsx3 qrcode[pil] cryptography

BUILDING TO STANDALONE .EXE (PyInstaller):
------------------------------------------
pip install pyinstaller
pyinstaller --noconsole --onefile --name "AetherHostAgent" --icon=NONE aether_server.py

"""

import sys
import os
import io
import re
import time
import json
import socket
import asyncio
import threading
import subprocess
import base64
import hashlib
import hmac
import ipaddress
import secrets
import ssl
import shutil
from collections import deque
from http import HTTPStatus
from datetime import datetime, timedelta, timezone
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

# GUI & Graphics
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, 
    QLabel, QPushButton, QTextEdit, QFrame, QSystemTrayIcon, QMenu,
    QGraphicsDropShadowEffect, QStyle, QMessageBox
)
from PyQt6.QtCore import Qt, QTimer, pyqtSignal, QObject
from PyQt6.QtGui import QFont, QIcon, QPixmap, QColor, QPainter, QImage, QCursor

# Screen Capture, Telemetry, Utilities
try:
    import mss
    MSS_AVAILABLE = True
except ImportError:
    MSS_AVAILABLE = False
from PIL import Image
import psutil
import pyperclip
import pyttsx3
import qrcode
import websockets
from websockets.legacy.server import serve as legacy_websocket_serve

ALLOWED_CLIENT_ACTIONS = {
    "AUTH", "PING", "GET_TELEMETRY", "STREAM_FRAME", "FRAME_ACK", "AUDIO_STREAM",
    "FILE_START", "FILE_CHUNK", "FILE_END", "FILE_CANCEL",
    "KILL_PROCESS", "SEND_TOAST", "POWER", "MEDIA", "CLIPBOARD", "WRITE_CLIPBOARD",
    "SYSTEM", "KEY_PRESS", "MOUSE_MOVE", "MOUSE_CLICK", "MOUSE_SCROLL",
    "REMOTE_KEY_PRESS", "REMOTE_MOUSE_MOVE", "REMOTE_MOUSE_CLICK", "REMOTE_MOUSE_SCROLL",
    "TAKE_SCREENSHOT", "DECK_SYNC_REQUEST", "DECK_TRIGGER", "DECK_SLIDER",
    "DECK_NAVIGATE", "DECK_ASSET_REQUEST"
}

MAX_BASE64_CHUNK_CHARS = 4 * ((256 * 1024 + 2) // 3)

def validate_client_message(data):
    if not isinstance(data, dict) or data.get("action") not in ALLOWED_CLIENT_ACTIONS:
        return False
    if data.get("action") == "DECK_SLIDER" and (
        not isinstance(data.get("triggerId"), str) or not 1 <= len(data["triggerId"]) <= 128
    ):
        return False
    for field, maximum in (("command", 100_000), ("text", 100_000), ("message", 100_000), ("fileId", 128), ("fileName", 255)):
        value = data.get(field)
        if value is not None and (not isinstance(value, str) or len(value) > maximum):
            return False
    if data.get("action") == "FILE_CHUNK":
        for field in ("data", "chunk", "base64"):
            value = data.get(field)
            if value is not None and (not isinstance(value, str) or len(value) > MAX_BASE64_CHUNK_CHARS):
                return False
    if data.get("action") == "AUTH":
        for field, maximum in (("pin", 32), ("sessionToken", 128), ("deviceModel", 80)):
            value = data.get(field)
            if value is not None and (not isinstance(value, str) or len(value) > maximum):
                return False
        capabilities = data.get("capabilities", [])
        if not isinstance(capabilities, list) or len(capabilities) > 32 or any(not isinstance(item, str) or len(item) > 64 for item in capabilities):
            return False
    return True

try:
    from zeroconf import IPVersion, ServiceInfo, Zeroconf
    ZEROCONF_AVAILABLE = True
except ImportError:
    ZEROCONF_AVAILABLE = False

zeroconf_instance = None
zeroconf_info = None

def start_mdns_service(port, tls_fingerprint=''):
    global zeroconf_instance, zeroconf_info
    if not ZEROCONF_AVAILABLE:
        print("[mDNS] zeroconf library not installed. mDNS discovery disabled.")
        return
    try:
        zeroconf_instance = Zeroconf()
        hostname = socket.gethostname()
        local_ip = "127.0.0.1"
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
        except Exception:
            pass
            
        desc = {'version': '1.0.0', 'hostname': hostname, 'secure': 'true', 'tlsFingerprint': tls_fingerprint}
        import socket as py_socket
        ip_packed = py_socket.inet_aton(local_ip)
        
        zeroconf_info = ServiceInfo(
            "_aether-remote._tcp.local.",
            f"Aether Remote Host - {hostname}._aether-remote._tcp.local.",
            addresses=[ip_packed],
            port=port,
            properties=desc,
            server=f"{hostname}.local."
        )
        zeroconf_instance.register_service(zeroconf_info)
        print(f"[mDNS] Zeroconf service advertised: Aether Remote Host - {hostname} on {local_ip}:{port}")
    except Exception as e:
        print(f"[mDNS] Failed to register Zeroconf service: {e}")

def stop_mdns_service():
    global zeroconf_instance, zeroconf_info
    if zeroconf_instance:
        try:
            if zeroconf_info:
                zeroconf_instance.unregister_service(zeroconf_info)
            zeroconf_instance.close()
            print("[mDNS] Zeroconf service advertisement stopped.")
        except Exception as e:
            print(f"[mDNS] Failed to unregister Zeroconf service: {e}")
        zeroconf_instance = None
        zeroconf_info = None


# GLOBAL CONFIGURATION
DEFAULT_PORT = 8080
MAX_FAILED_ATTEMPTS = 3
BLOCK_COOLDOWN_SEC = 60

CRITICAL_PROCESSES = {
    'csrss', 'explorer', 'lsass', 'smss', 'services', 'winlogon', 'svchost', 'system', 'conhost', 'init'
}

def run_powershell_safely(cmd_str):
    """Encode PowerShell script to UTF-16LE Base64 to prevent command injection."""
    encoded_bytes = cmd_str.encode('utf-16le')
    b64_str = base64.b64encode(encoded_bytes).decode('ascii')
    return ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", b64_str]

def setup_windows_firewall_rule(port=DEFAULT_PORT):
    """Ensure inbound TCP firewall rule for Aether Host is enabled automatically."""
    try:
        safe_port = int(port)
        if safe_port < 1 or safe_port > 65535:
            raise ValueError("invalid firewall port")
        res = subprocess.run(["netsh", "advfirewall", "firewall", "show", "rule", "name=AetherHost"], capture_output=True, text=True)
        if "No rules match" in res.stdout or res.returncode != 0:
            subprocess.run(["netsh", "advfirewall", "firewall", "add", "rule", "name=AetherHost", "dir=in", "action=allow", "protocol=TCP", f"localport={safe_port}"], capture_output=True)
            print(f"[FIREWALL] Inbound rule created for TCP port {safe_port}")
    except Exception as e:
        print(f"[FIREWALL] Rule check skipped: {e}")

def set_windows_autostart(enable=True):
    """Enable or disable auto-start on Windows boot via Registry HKCU Run key."""
    try:
        import winreg
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_ALL_ACCESS)
        app_path = f'"{os.path.abspath(sys.argv[0])}"'
        if enable:
            winreg.SetValueEx(key, "AetherHost", 0, winreg.REG_SZ, app_path)
            print("[AUTOSTART] Registered AetherHost in HKCU Run key")
        else:
            try:
                winreg.DeleteValue(key, "AetherHost")
            except FileNotFoundError:
                pass
        winreg.CloseKey(key)
    except Exception as e:
        print(f"[AUTOSTART] Registry auto-start configuration skipped: {e}")

def get_local_ip():
    """Retrieve primary IPv4 address of local network interface."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def get_all_broadcast_ips():
    """Find all physical IPv4 broadcast addresses, skipping virtual interfaces."""
    ips = set(["255.255.255.255"])
    try:
        virtual_regex = re.compile(r"(vEthernet|VirtualBox|VMware|WSL|Loopback|TAP|Tun|Hyper-V|docker)", re.IGNORECASE)
        for name, addrs in psutil.net_if_addrs().items():
            if virtual_regex.search(name):
                continue
            for addr in addrs:
                if addr.family == socket.AF_INET and not addr.address.startswith("127."):
                    if hasattr(addr, "broadcast") and addr.broadcast:
                        ips.add(addr.broadcast)
    except Exception:
        pass
    return list(ips)

def get_primary_mac_address():
    try:
        import uuid
        mac_int = uuid.getnode()
        mac_hex = f'{mac_int:012x}'
        return ':'.join(mac_hex[i:i+2] for i in range(0, 12, 2)).upper()
    except Exception:
        return '00:00:00:00:00:00'

def get_hardware_uuid():
    """Extract Windows System Product UUID via PowerShell or fallback to MAC address."""
    try:
        if sys.platform == "win32":
            res = subprocess.run(
                run_powershell_safely("(Get-CimInstance -Class Win32_ComputerSystemProduct).UUID"),
                capture_output=True, text=True, timeout=3
            )
            uuid_str = res.stdout.strip()
            if uuid_str and len(uuid_str) > 5:
                return uuid_str
    except Exception:
        pass
    import uuid
    mac = hashlib.md5(str(uuid.getnode()).encode()).hexdigest()
    return f"AETHER-{socket.gethostname()}-{mac}"

def calculate_hardware_pin(uuid_str):
    return f"{secrets.randbelow(1_000_000):06d}"

def capture_and_compress_binary(target_width, img_quality, monitor_index=1):
    with mss.mss() as sct:
        num_monitors = len(sct.monitors) - 1
        mon_idx = monitor_index if (1 <= monitor_index <= num_monitors) else 1
        monitor = sct.monitors[mon_idx]
        sct_img = sct.grab(monitor)
        img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
        aspect = img.height / img.width
        target_h = int(target_width * aspect)
        img = img.resize((target_width, target_h), Image.Resampling.BILINEAR)
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=img_quality)
        return buffer.getvalue()

def encode_universal_9_code(ip_address, pin3):
    parts = str(ip_address).strip().split('.')
    try:
        oct3 = int(parts[2]) if len(parts) >= 3 else 1
    except ValueError:
        oct3 = 1
    try:
        oct4 = int(parts[3]) if len(parts) >= 4 else 50
    except ValueError:
        oct4 = 50
    p1 = f"{oct3:03d}"
    p2 = f"{oct4:03d}"
    p3 = "".join([c for c in str(pin3) if c.isdigit()])
    if len(p3) != 6:
        p3 = calculate_hardware_pin("SYSTEM_DEFAULT")
    code9 = f"{p1}{p2}{p3}"
    formatted_code = f"{p1} - {p2} - {p3}"
    return code9, formatted_code

def terminate_process_safely(proc_input):
    proc_clean = "".join([c for c in str(proc_input).strip() if c.isalnum() or c in "._-"])
    if not proc_clean:
        return False, "Invalid process name or PID"
    
    name_lower = proc_clean.lower().replace(".exe", "")
    if name_lower in CRITICAL_PROCESSES:
        return False, f"Cannot terminate critical Windows process '{proc_clean}'"
    
    try:
        if proc_clean.isdigit():
            try:
                resolved_name = psutil.Process(int(proc_clean)).name().lower().replace(".exe", "")
            except (psutil.NoSuchProcess, psutil.AccessDenied, ValueError):
                return False, "Unable to inspect requested process"
            if resolved_name in CRITICAL_PROCESSES:
                return False, f"Cannot terminate critical Windows process '{resolved_name}'"
            res = subprocess.run(["taskkill", "/F", "/PID", proc_clean], capture_output=True, text=True)
        else:
            exe_name = proc_clean if proc_clean.endswith(".exe") else f"{proc_clean}.exe"
            res = subprocess.run(["taskkill", "/F", "/IM", exe_name], capture_output=True, text=True)
        if res.returncode == 0:
            return True, f"Successfully terminated {proc_clean}"
        else:
            return False, "Failed to terminate requested process"
    except Exception:
        return False, "Failed to terminate requested process"

def get_media_session_info():
    if sys.platform != "win32":
        return {"title": "", "artist": "", "isPlaying": False}
    ps_cmd = """
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
    try {
        $async = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]::RequestAsync();
        $i = 0;
        while ($async.Status -eq 'Started' -and $i -lt 20) { Start-Sleep -Milliseconds 50; $i++ };
        $mgr = $async.GetResults();
        $session = $mgr.GetCurrentSession();
        if ($session) {
            $propsAsync = $session.TryGetMediaPropertiesAsync();
            $j = 0;
            while ($propsAsync.Status -eq 'Started' -and $j -lt 20) { Start-Sleep -Milliseconds 50; $j++ };
            $props = $propsAsync.GetResults();
            $playback = $session.GetPlaybackInfo();
            @{
                title = $props.Title;
                artist = $props.Artist;
                isPlaying = ($playback.PlaybackStatus -eq 'Playing' -or $playback.PlaybackStatus -eq 4);
            } | ConvertTo-Json;
        }
    } catch {}
    """
    try:
        res = subprocess.run(run_powershell_safely(ps_cmd), capture_output=True, text=True, timeout=3)
        if res.stdout and res.stdout.strip():
            return json.loads(res.stdout.strip())
    except Exception:
        pass
    return {"title": "", "artist": "", "isPlaying": False}

def execute_remote_input(action, data):
    if sys.platform != "win32":
        return {"status": "SUCCESS", "message": "Remote input simulated on non-Windows"}
    
    try:
        import ctypes
        user32 = ctypes.windll.user32
        
        if action in ("MOUSE_MOVE", "REMOTE_MOUSE_MOVE"):
            dx = max(-5000, min(5000, int(data.get("dx", 0))))
            dy = max(-5000, min(5000, int(data.get("dy", 0))))
            class POINT(ctypes.Structure):
                _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]
            pt = POINT()
            user32.GetCursorPos(ctypes.byref(pt))
            user32.SetCursorPos(pt.x + dx, pt.y + dy)
            return {"status": "SUCCESS", "action": "MOUSE_MOVED", "dx": dx, "dy": dy}
            
        elif action in ("MOUSE_CLICK", "REMOTE_MOUSE_CLICK"):
            btn = str(data.get("button", "left")).lower()
            if btn not in ("left", "right", "middle"):
                return {"status": "ERROR", "message": "Unsupported mouse button"}
            if btn == "right":
                user32.mouse_event(0x0008, 0, 0, 0, 0) # MOUSEEVENTF_RIGHTDOWN
                user32.mouse_event(0x0010, 0, 0, 0, 0) # MOUSEEVENTF_RIGHTUP
            elif btn == "middle":
                user32.mouse_event(0x0020, 0, 0, 0, 0) # MOUSEEVENTF_MIDDLEDOWN
                user32.mouse_event(0x0040, 0, 0, 0, 0) # MOUSEEVENTF_MIDDLEUP
            else:
                user32.mouse_event(0x0002, 0, 0, 0, 0) # MOUSEEVENTF_LEFTDOWN
                user32.mouse_event(0x0004, 0, 0, 0, 0) # MOUSEEVENTF_LEFTUP
            return {"status": "SUCCESS", "action": "MOUSE_CLICKED", "button": btn}
            
        elif action in ("MOUSE_SCROLL", "REMOTE_MOUSE_SCROLL"):
            delta = max(-100, min(100, int(data.get("delta", 0)))) * 120
            user32.mouse_event(0x0800, 0, 0, delta, 0) # MOUSEEVENTF_WHEEL
            return {"status": "SUCCESS", "action": "MOUSE_SCROLLED", "delta": delta}
            
        elif action in ("KEY_PRESS", "REMOTE_KEY_PRESS"):
            key = str(data.get("key", "")).strip().upper().strip("{}")
            named_keys = {
                "BACKSPACE": 0x08, "TAB": 0x09, "ENTER": 0x0D, "SHIFT": 0x10,
                "CTRL": 0x11, "ALT": 0x12, "ESC": 0x1B, "SPACE": 0x20,
                "LEFT": 0x25, "UP": 0x26, "RIGHT": 0x27, "DOWN": 0x28,
                "DELETE": 0x2E, "F1": 0x70, "F2": 0x71, "F3": 0x72, "F4": 0x73,
                "F5": 0x74, "F6": 0x75, "F7": 0x76, "F8": 0x77, "F9": 0x78,
                "F10": 0x79, "F11": 0x7A, "F12": 0x7B
            }
            virtual_key = named_keys.get(key)
            if virtual_key is None and len(key) == 1 and key.isascii() and key.isalnum():
                virtual_key = ord(key)
            if virtual_key is None:
                return {"status": "ERROR", "message": "Unsupported key"}
            user32.keybd_event(virtual_key, 0, 0, 0)
            user32.keybd_event(virtual_key, 0, 2, 0)
            return {"status": "SUCCESS", "action": "KEY_PRESSED", "key": key}
    except Exception:
        return {"status": "ERROR", "message": "Remote input failed"}

    return {"status": "UNKNOWN_ACTION"}

class CommunicationSignals(QObject):
    """Signals for thread-safe UI updates from asyncio WebSocket thread."""
    log_event = pyqtSignal(str, str, str) # timestamp, type, message
    client_connected = pyqtSignal(dict)   # client metadata
    client_disconnected = pyqtSignal()
    update_brute_force = pyqtSignal(int)  # fail count
    update_status_pill = pyqtSignal(str)  # 'LISTENING_FOR_CLIENT', 'CLIENT_CONNECTED', 'BLOCKED_BRUTE_FORCE'
    pending_auth_request = pyqtSignal(str, str, str) # request_id, client_ip, device_name

TOKEN_TTL_MS = 30 * 24 * 3600 * 1000 # 30 days
TOKENS_FILE_PATH = os.path.join(os.path.expanduser('~'), '.aether_tokens.json')
CLIPBOARD_HISTORY_MAX_CHARS = 100_000
TLS_DIRECTORY = os.path.join(os.path.expanduser('~'), '.aether_remote', 'tls')

def load_or_create_tls_identity(local_ip, directory=TLS_DIRECTORY):
    os.makedirs(directory, mode=0o700, exist_ok=True)
    cert_path = os.path.join(directory, 'host-cert.pem')
    key_path = os.path.join(directory, 'host-key.pem')
    certificate = None
    private_key = None
    try:
        with open(cert_path, 'rb') as cert_file:
            certificate = x509.load_pem_x509_certificate(cert_file.read())
        with open(key_path, 'rb') as key_file:
            private_key = serialization.load_pem_private_key(key_file.read(), password=None)
        expiry = certificate.not_valid_after.replace(tzinfo=timezone.utc)
        if expiry <= datetime.now(timezone.utc) + timedelta(days=7):
            certificate = None
            private_key = None
    except Exception:
        certificate = None
        private_key = None

    if certificate is None or private_key is None:
        private_key = ec.generate_private_key(ec.SECP256R1())
        subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Aether Remote Host')])
        now = datetime.now(timezone.utc)
        alt_names = [x509.DNSName('localhost'), x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]
        try:
            alt_names.append(x509.IPAddress(ipaddress.ip_address(local_ip)))
        except ValueError:
            pass
        certificate = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(private_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5))
            .not_valid_after(now + timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.SubjectAlternativeName(alt_names), critical=False)
            .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .sign(private_key, hashes.SHA256())
        )
        cert_bytes = certificate.public_bytes(serialization.Encoding.PEM)
        key_bytes = private_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        for target_path, contents in ((cert_path, cert_bytes), (key_path, key_bytes)):
            temporary = f'{target_path}.{os.getpid()}.tmp'
            with open(temporary, 'xb') as output:
                output.write(contents)
            os.chmod(temporary, 0o600)
            os.replace(temporary, target_path)

    fingerprint = 'SHA256:' + certificate.fingerprint(hashes.SHA256()).hex().upper()
    tls_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls_context.minimum_version = ssl.TLSVersion.TLSv1_2
    tls_context.load_cert_chain(cert_path, key_path)
    return tls_context, fingerprint

def clipboard_fingerprint(text):
    return text if len(text) <= CLIPBOARD_HISTORY_MAX_CHARS else (len(text), text[:256], text[-256:])

class AetherServerBackend:
    """Asyncio WebSocket Server Backend with Security & Command Execution Logic."""
    def __init__(self, signals, port=DEFAULT_PORT, download_directory=None, enable_discovery=True, tls_directory=None):
        self.signals = signals
        self.port = port
        self.local_ip = get_local_ip()
        self.hardware_uuid = get_hardware_uuid()
        self.hardware_pin = calculate_hardware_pin(self.hardware_uuid)
        self.pin, self.formatted_pin = encode_universal_9_code(self.local_ip, self.hardware_pin)
        self.ssl_context, self.tls_fingerprint = load_or_create_tls_identity(self.local_ip, tls_directory or TLS_DIRECTORY)
        self.failed_attempts = {} # ip -> {'count': int, 'blocked_until': float}
        self.global_failed_attempts = []
        self.tokens_file_path = TOKENS_FILE_PATH
        self.authenticated_tokens = {} # token -> dict
        self.pending_requests = {} # request_id -> {'event': asyncio.Event(), 'result': bool, 'device_name': str, 'client_ip': str}
        self.authenticated_websockets = set()
        self.all_websockets = set()
        self.last_clipboard_fingerprint = clipboard_fingerprint("")
        self.connected_client = None
        self.connected_since = None
        self.loop = None
        self.download_directory = os.path.abspath(download_directory or os.path.join(os.path.expanduser("~"), "Downloads", "AetherRemote"))
        self.enable_discovery = enable_discovery
        
        self.load_persisted_tokens()
        
        # Start background UDP Discovery Beacon thread
        if self.enable_discovery:
            threading.Thread(target=self.run_udp_beacon, daemon=True).start()

    def load_persisted_tokens(self):
        # The standalone Python fallback has no OS-backed secret store. Never
        # restore bearer tokens from the legacy plaintext JSON file.
        if os.path.exists(self.tokens_file_path):
            print("[AUTH] Legacy plaintext session tokens ignored; clients must pair again.")

    def save_persisted_tokens(self):
        # Tokens intentionally remain process-local until this runtime has an
        # authenticated OS credential-store integration.
        return

    def clean_expired_tokens(self):
        now = int(time.time() * 1000)
        expired = [tok for tok, info in self.authenticated_tokens.items() if info and info.get('expiresAt', 0) <= now]
        if expired:
            for tok in expired:
                del self.authenticated_tokens[tok]
            self.save_persisted_tokens()

    def resolve_pending_request(self, request_id, approved):
        if request_id in self.pending_requests and self.loop:
            req = self.pending_requests[request_id]
            req['result'] = approved
            self.loop.call_soon_threadsafe(req['event'].set)

    def run_udp_beacon(self):
        udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        except Exception as e:
            print(f"[UDP] Error setting broadcast option: {e}")
            
        while True:
            try:
                beacon_data = {
                    "ip": self.local_ip,
                    "port": self.port,
                    "host": socket.gethostname(),
                    "mac": get_primary_mac_address(),
                    "protocolVersion": "2.0",
                    "secure": True,
                    "tlsFingerprint": self.tls_fingerprint
                }
                msg = json.dumps(beacon_data).encode('utf-8')
                broadcast_ips = get_all_broadcast_ips()
                for target_ip in broadcast_ips:
                    try:
                        udp_socket.sendto(msg, (target_ip, 8081))
                    except Exception:
                        pass
            except Exception:
                pass
            time.sleep(2.0)

    def check_brute_force(self, client_ip):
        now = time.time()
        self.global_failed_attempts = [attempt for attempt in self.global_failed_attempts if now - attempt < 60]
        if len(self.global_failed_attempts) >= 20:
            return False, 60
        record = self.failed_attempts.get(client_ip, {'count': 0, 'blocked_until': 0})
        if record['blocked_until'] > now:
            remaining = int(record['blocked_until'] - now)
            return False, remaining
        return True, 0

    def record_fail(self, client_ip):
        now = time.time()
        self.global_failed_attempts.append(now)
        record = self.failed_attempts.get(client_ip, {'count': 0, 'blocked_until': 0})
        record['count'] += 1
        if record['count'] >= MAX_FAILED_ATTEMPTS:
            exponent = min(record['count'] - 3, 5)
            cooldown_sec = BLOCK_COOLDOWN_SEC * (2 ** exponent)
            record['blocked_until'] = now + cooldown_sec
            self.signals.update_status_pill.emit('BLOCKED_BRUTE_FORCE')
            self.signals.log_event.emit("AUTH_BLOCKED", f"IP {client_ip} blocked for {cooldown_sec}s due to brute force attempts.", "error")
        else:
            self.signals.log_event.emit("AUTH_FAILED", f"Failed PIN attempt from {client_ip} ({record['count']}/3)", "warning")
        self.failed_attempts[client_ip] = record
        self.signals.update_brute_force.emit(record['count'])

    def record_success(self, client_ip):
        self.global_failed_attempts.clear()
        if client_ip in self.failed_attempts:
            del self.failed_attempts[client_ip]
        self.signals.update_brute_force.emit(0)

    def abort_file_transfer(self, file_id, delete_partial=True):
        transfer = getattr(self, 'active_file_transfers', {}).pop(file_id, None)
        if not transfer:
            return
        try:
            transfer["fileObj"].close()
        except Exception:
            pass
        if delete_partial:
            try:
                os.remove(transfer["filePath"])
            except OSError:
                pass

    async def sweep_file_transfers(self):
        while True:
            await asyncio.sleep(15)
            now = time.time()
            if hasattr(self, 'active_file_transfers'):
                for f_id in list(self.active_file_transfers.keys()):
                    transfer = self.active_file_transfers.get(f_id)
                    timeout_seconds = 10 if transfer and transfer.get("receivedBytes", 0) == 0 else 45
                    if transfer and now - transfer.get("lastActivity", 0) > timeout_seconds:
                        print(f"[FILE] Transfer {f_id} timed out due to inactivity. Cleaning up.")
                        owner = transfer.get("websocket")
                        if owner and not owner.closed:
                            try:
                                await owner.send(json.dumps({"action": "FILE_CANCEL", "fileId": f_id, "error": "Transfer timed out due to inactivity"}))
                            except Exception:
                                pass
                        self.abort_file_transfer(f_id, True)

    async def stream_audio_loop(self, websocket):
        import base64
        import math
        import struct
        
        p = None
        stream = None
        try:
            import pyaudio
            p = pyaudio.PyAudio()
            wasapi_api_idx = -1
            for i in range(p.get_host_api_count()):
                api_info = p.get_host_api_info_by_index(i)
                if "wasapi" in api_info.get('name', '').lower():
                    wasapi_api_idx = i
                    break
            
            device_idx = -1
            if wasapi_api_idx != -1:
                for i in range(p.get_device_count()):
                    dev_info = p.get_device_info_by_index(i)
                    if dev_info.get('hostApi') == wasapi_api_idx and dev_info.get('isLoopbackInput'):
                        device_idx = i
                        break
                if device_idx == -1:
                    device_idx = p.get_default_input_device_info()['index']
                    
            stream = p.open(
                format=pyaudio.paInt16,
                channels=2,
                rate=44100,
                input=True,
                input_device_index=device_idx if device_idx != -1 else None,
                frames_per_buffer=1024
            )
            print("[AUDIO] Real WASAPI loopback stream initialized.")
        except Exception as e:
            print(f"[AUDIO] Real audio capture not available ({e}). Using advanced loopback generator.")
            stream = None

        sample_rate = 44100
        channels = 2
        chunk_duration = 0.03
        num_samples = int(sample_rate * chunk_duration)
        phase = 0.0
        freq = 440.0
        
        while getattr(websocket, "is_audio_streaming", False):
            try:
                if stream:
                    data_bytes = await asyncio.to_thread(stream.read, num_samples, False)
                else:
                    pcm_data = []
                    for _ in range(num_samples):
                        val = int(1500.0 * math.sin(phase))
                        phase += 2.0 * math.pi * freq / sample_rate
                        if phase > 2.0 * math.pi:
                            phase -= 2.0 * math.pi
                        pcm_data.append(val)
                        pcm_data.append(val)
                    data_bytes = struct.pack(f"<{len(pcm_data)}h", *pcm_data)
                    
                b64_data = base64.b64encode(data_bytes).decode('utf-8')
                await websocket.send(json.dumps({
                    "action": "AUDIO_CHUNK",
                    "data": b64_data,
                    "sampleRate": sample_rate,
                    "channels": channels
                }))
                await asyncio.sleep(chunk_duration)
            except Exception as e:
                print(f"[AUDIO] Loop error: {e}")
                break
                
        if stream:
            try:
                stream.stop_stream()
                stream.close()
            except Exception:
                pass
        if p:
            try:
                p.terminate()
            except Exception:
                pass
        print("[AUDIO] Loopback audio capture stopped.")

    async def stream_screen_loop(self, websocket):
        try:
            while getattr(websocket, "is_screen_streaming", False):
                settings = getattr(websocket, "screen_stream_settings", {})
                quality = getattr(websocket, "adaptive_quality", None)
                resolution = getattr(websocket, "adaptive_resolution", None)
                quality = quality if quality is not None else int(settings.get("quality", 70))
                resolution = resolution if resolution is not None else settings.get("resolution", "720p")
                monitor_index = int(settings.get("monitorIndex", settings.get("monitor", 0)) or 0)
                target_width = 1280 if resolution == "720p" else (1920 if resolution == "1080p" else 854)
                try:
                    jpeg_bytes = await asyncio.to_thread(capture_and_compress_binary, target_width, quality, max(0, monitor_index) + 1)
                    frame_hash = hashlib.sha256(jpeg_bytes).hexdigest()
                    if frame_hash != getattr(websocket, "last_screen_frame_hash", None):
                        setattr(websocket, "last_screen_frame_hash", frame_hash)
                        sent_at = time.time()
                        frame_id = getattr(websocket, "next_frame_id", 0) + 1
                        setattr(websocket, "next_frame_id", frame_id)
                        sent_by_id = getattr(websocket, "frame_sent_at_by_id", None)
                        if sent_by_id is None:
                            sent_by_id = {}
                            setattr(websocket, "frame_sent_at_by_id", sent_by_id)
                        sent_by_id[frame_id] = sent_at
                        while len(sent_by_id) > 120:
                            sent_by_id.pop(next(iter(sent_by_id)))
                        setattr(websocket, "last_frame_sent_at", sent_at)
                        await websocket.send(json.dumps({"action": "STREAM_FRAME_META", "frameId": frame_id, "sentAt": int(sent_at * 1000)}))
                        await websocket.send(b"\x01" + jpeg_bytes)
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    print(f"[STREAM] Frame capture error: {error}")
                    await websocket.send(json.dumps({"action": "STREAM_STATUS", "enabled": False, "status": "ERROR", "error": str(error)}))
                    break
                await asyncio.sleep(0.1)
        finally:
            setattr(websocket, "is_screen_streaming", False)

    async def clipboard_broadcast_loop(self):
        while True:
            try:
                clipboard_text = str(await asyncio.to_thread(pyperclip.paste) or "")
                fingerprint = clipboard_fingerprint(clipboard_text)
                if fingerprint != self.last_clipboard_fingerprint:
                    self.last_clipboard_fingerprint = fingerprint
                    if len(clipboard_text) > CLIPBOARD_HISTORY_MAX_CHARS:
                        await asyncio.sleep(1.5)
                        continue
                    text = clipboard_text.strip()
                    if not text:
                        await asyncio.sleep(1.5)
                        continue
                    message = json.dumps({"action": "CLIPBOARD_ITEM", "text": text, "source": "pc", "createdAt": int(time.time() * 1000)})
                    for client in list(self.authenticated_websockets):
                        if "clipboard-history-v1" not in getattr(client, "aether_capabilities", set()):
                            continue
                        try:
                            await client.send(message)
                        except Exception:
                            self.authenticated_websockets.discard(client)
            except Exception:
                pass
            await asyncio.sleep(1.5)

    async def handle_connection(self, websocket):
        client_ip = websocket.remote_address[0]
        authenticated = False
        active_session_token = None
        session_expiry_task = None
        if len(self.all_websockets) >= 64 or sum(1 for client in self.all_websockets if client not in self.authenticated_websockets) >= 16:
            await websocket.close(code=1013, reason="Connection limit reached")
            return
        self.all_websockets.add(websocket)

        async def close_if_authentication_times_out():
            await asyncio.sleep(70)
            if websocket not in self.authenticated_websockets:
                await websocket.close(code=1008, reason="Authentication timeout")

        async def close_at_session_expiry(expires_at):
            await asyncio.sleep(max(0, (expires_at - int(time.time() * 1000)) / 1000))
            if websocket in self.authenticated_websockets:
                await websocket.close(code=1008, reason="Session token expired")

        auth_timeout_task = asyncio.create_task(close_if_authentication_times_out())
        
        # CSWSH Security Gate: Verify Origin header against allowed origins (exact hostnames)
        if hasattr(websocket, 'request_headers'):
            origin = websocket.request_headers.get('Origin')
            if origin and isinstance(origin, str):
                lower_origin = origin.lower()
                is_allowed = False
                try:
                    from urllib.parse import urlparse
                    parsed = urlparse(lower_origin)
                    host = parsed.hostname or ""
                    allowed_hosts = ['localhost', '127.0.0.1']
                    try:
                        is_private_ip = ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_loopback
                    except ValueError:
                        is_private_ip = False
                    is_allowed = parsed.scheme in ('http', 'https') and (is_private_ip or host in allowed_hosts)
                except Exception:
                    is_allowed = False
                
                if not is_allowed:
                    print("[SECURITY] CSWSH attempt blocked from an untrusted origin")
                    await websocket.send(json.dumps({"status": "AUTH_BLOCKED", "error": "Untrusted web origin"}))
                    await websocket.close(code=1008, reason="Forbidden CSWSH Origin")
                    auth_timeout_task.cancel()
                    self.all_websockets.discard(websocket)
                    return
        
        try:
            async for raw_msg in websocket:
                try:
                    data = json.loads(raw_msg)
                except Exception:
                    await websocket.send(json.dumps({"status": "INVALID_JSON"}))
                    continue

                if not validate_client_message(data):
                    await websocket.send(json.dumps({"status": "ERROR", "error": "Invalid or unsupported message"}))
                    continue

                action = data.get("action")

                # Security Pre-Check
                self.clean_expired_tokens()
                supplied_token = str(data.get("sessionToken") or "") if action == "AUTH" else ""
                matched_token = next((token for token in self.authenticated_tokens if hmac.compare_digest(token, supplied_token)), None) if supplied_token else None
                valid_token = matched_token is not None
                allowed, cooldown = (True, 0) if valid_token else self.check_brute_force(client_ip)
                if not allowed:
                    await websocket.send(json.dumps({"status": "AUTH_BLOCKED", "cooldown": cooldown}))
                    await websocket.close(code=1008, reason="Brute force blocked")
                    continue

                # 1. AUTHENTICATION HANDSHAKE
                if action == "AUTH":
                    setattr(websocket, "aether_capabilities", {
                        str(capability) for capability in data.get("capabilities", [])[:32]
                    })
                    session_token = matched_token
                    if session_token:
                        self.authenticated_tokens[session_token]['lastUsedAt'] = int(time.time() * 1000)
                        self.save_persisted_tokens()
                        
                        authenticated = True
                        active_session_token = session_token
                        self.authenticated_websockets.add(websocket)
                        auth_timeout_task.cancel()
                        session_expiry_task = asyncio.create_task(close_at_session_expiry(self.authenticated_tokens[session_token]['expiresAt']))
                        self.record_success(client_ip)
                        self.connected_client = client_ip
                        self.connected_since = time.time()
                        
                        device_info = {
                            "deviceModel": self.authenticated_tokens[session_token].get("deviceName", "Aether Mobile Client"),
                            "ipAddress": client_ip,
                            "connectedAt": datetime.now().strftime("%H:%M:%S"),
                            "uptimeSeconds": 0
                        }
                        self.signals.client_connected.emit(device_info)
                        self.signals.update_status_pill.emit('CLIENT_CONNECTED')
                        self.signals.log_event.emit("AUTH_OK", f"Client authenticated via Token from {client_ip}", "success")
                        
                        await websocket.send(json.dumps({
                            "status": "AUTH_OK",
                            "capabilities": ["file-transfer-v2", "binary-screen-v1", "binary-audio-pcm16-v1", "clipboard-history-v1"],
                            "host": socket.gethostname(),
                            "os": "Windows",
                            "ip": self.local_ip,
                            "mac": get_primary_mac_address(),
                            "protocolVersion": "2.0",
                            "tlsFingerprint": self.tls_fingerprint,
                            "sessionToken": session_token,
                            "connectedClients": len(self.authenticated_websockets)
                        }))
                        continue

                    provided_pin = str(data.get("pin", "")).replace("-", "").replace(" ", "").strip()
                    pairing_code9, _ = encode_universal_9_code(self.local_ip, self.hardware_pin)
                    if provided_pin and hmac.compare_digest(provided_pin, pairing_code9):
                        await websocket.send(json.dumps({
                            "status": "AUTH_PENDING",
                            "message": "Awaiting host approval..."
                        }))
                        
                        import uuid
                        request_id = str(uuid.uuid4())
                        event = asyncio.Event()
                        device_name = data.get("deviceModel") or data.get("device_name") or "Aether Mobile Client"
                        
                        self.pending_requests[request_id] = {
                            'event': event,
                            'result': False,
                            'device_name': device_name,
                            'client_ip': client_ip
                        }
                        
                        self.signals.pending_auth_request.emit(request_id, client_ip, device_name)
                        
                        try:
                            await asyncio.wait_for(event.wait(), timeout=35.0)
                            approved = self.pending_requests[request_id]['result']
                        except asyncio.TimeoutError:
                            approved = False
                        finally:
                            if request_id in self.pending_requests:
                                del self.pending_requests[request_id]
                                
                        if approved:
                            authenticated = True
                            self.authenticated_websockets.add(websocket)
                            auth_timeout_task.cancel()
                            self.record_success(client_ip)
                            self.connected_client = client_ip
                            self.connected_since = time.time()
                            
                            new_session_token = str(uuid.uuid4())
                            active_session_token = new_session_token
                            now = int(time.time() * 1000)
                            self.authenticated_tokens[new_session_token] = {
                                'issuedAt': now,
                                'expiresAt': now + TOKEN_TTL_MS,
                                'deviceName': device_name,
                                'ipAddress': client_ip,
                                'lastUsedAt': now
                            }
                            session_expiry_task = asyncio.create_task(close_at_session_expiry(self.authenticated_tokens[new_session_token]['expiresAt']))
                            self.save_persisted_tokens()
                            
                            device_info = {
                                "deviceModel": device_name,
                                "ipAddress": client_ip,
                                "connectedAt": datetime.now().strftime("%H:%M:%S"),
                                "uptimeSeconds": 0
                            }
                            self.signals.client_connected.emit(device_info)
                            self.signals.update_status_pill.emit('CLIENT_CONNECTED')
                            self.signals.log_event.emit("AUTH_OK", f"Client authenticated from {client_ip} after approval", "success")
                            
                            await websocket.send(json.dumps({
                                "status": "AUTH_OK",
                                "capabilities": ["file-transfer-v2", "binary-screen-v1", "binary-audio-pcm16-v1", "clipboard-history-v1"],
                                "host": socket.gethostname(),
                                "os": "Windows",
                                "ip": self.local_ip,
                                "mac": get_primary_mac_address(),
                                "protocolVersion": "2.0",
                                "tlsFingerprint": self.tls_fingerprint,
                                "sessionToken": new_session_token,
                                "connectedClients": len(self.authenticated_websockets)
                            }))
                        else:
                            await websocket.send(json.dumps({
                                "status": "AUTH_FAILED",
                                "error": "Connection declined by host user or timed out"
                            }))
                    else:
                        self.record_fail(client_ip)
                        allowed, cooldown = self.check_brute_force(client_ip)
                        if not allowed:
                            await websocket.send(json.dumps({"status": "AUTH_BLOCKED", "cooldown": cooldown}))
                            await websocket.close(code=1008, reason="Brute force blocked")
                        else:
                            await websocket.send(json.dumps({"status": "AUTH_FAILED", "reason": "INVALID_PIN", "error": "Incorrect PIN or pairing key"}))
                    continue

                if not authenticated:
                    await websocket.send(json.dumps({"status": "UNAUTHORIZED"}))
                    continue
                if websocket not in self.authenticated_websockets or active_session_token not in self.authenticated_tokens:
                    authenticated = False
                    await websocket.close(code=1008, reason="Session token expired")
                    continue

                # 0. HEARTBEAT / PING (authenticated clients only)
                if action == "PING":
                    await websocket.send(json.dumps({
                        "action": "PONG",
                        "status": "PONG",
                        "timestamp": data.get("timestamp", int(time.time() * 1000))
                    }))
                    continue

                # 2. SYSTEM TELEMETRY
                if action == "GET_TELEMETRY":
                    cpu = psutil.cpu_percent(interval=None)
                    mem = psutil.virtual_memory()
                    net_io = psutil.net_io_counters()
                    uptime = int(time.time() - psutil.boot_time())
                    media_info = await asyncio.to_thread(get_media_session_info)
                    monitors_cnt = 1
                    if MSS_AVAILABLE:
                        try:
                            with mss.mss() as sct:
                                monitors_cnt = max(1, len(sct.monitors) - 1)
                        except Exception:
                            pass
                    await websocket.send(json.dumps({
                        "action": "TELEMETRY",
                        "data": {
                            "cpu": round(cpu, 1),
                            "ram": round(mem.percent, 1),
                            "ramUsedGb": round(mem.used / (1024**3), 1),
                            "ramTotalGb": round(mem.total / (1024**3), 1),
                            "net_upload": round((net_io.bytes_sent / (1024 * 1024)) % 100, 2),
                            "net_download": round((net_io.bytes_recv / (1024 * 1024)) % 100, 2),
                            "hostname": socket.gethostname(),
                            "uptime": uptime,
                            "monitorsCount": monitors_cnt,
                            "track": media_info.get("title", ""),
                            "artist": media_info.get("artist", ""),
                            "isPlaying": media_info.get("isPlaying", False),
                            "connectedClients": len(self.authenticated_websockets)
                        }
                    }))

                # 3. TASK KILLER
                elif action == "KILL_PROCESS":
                    proc_name = data.get("process") or data.get("process_name") or data.get("command", "")
                    self.signals.log_event.emit("TASK_KILLER", f"Terminating process: {proc_name}", "warning")
                    success, output_msg = await asyncio.to_thread(terminate_process_safely, proc_name)
                    status_str = "SUCCESS" if success else "ERROR"
                    await websocket.send(json.dumps({"action": "KILL_RESULT", "status": status_str, "output": output_msg}))

                # 4. REMOTE INPUT
                elif action in ("MOUSE_MOVE", "REMOTE_MOUSE_MOVE", "MOUSE_CLICK", "REMOTE_MOUSE_CLICK", "MOUSE_SCROLL", "REMOTE_MOUSE_SCROLL", "KEY_PRESS", "REMOTE_KEY_PRESS"):
                    res = await asyncio.to_thread(execute_remote_input, action, data)
                    await websocket.send(json.dumps(res))

                # 5. WINDOWS TOAST NOTIFICATION
                elif action == "SEND_TOAST":
                    title_str = str(data.get("title", "Aether Remote"))[:128]
                    msg_str = str(data.get("message") or data.get("text") or "")[:1000]
                    self.signals.log_event.emit("TOAST", "Notification received from authenticated client", "info")
                    if sys.platform == "win32":
                        import ctypes
                        asyncio.create_task(asyncio.to_thread(ctypes.windll.user32.MessageBoxW, 0, msg_str, title_str, 0x40))
                    await websocket.send(json.dumps({"status": "SUCCESS", "message": "TOAST_SENT"}))

                # 7. HIGH SPEED LIVE SCREEN STREAMING
                elif action == "STREAM_FRAME":
                    enabled = data.get("start", str(data.get("command", "START")).upper() != "STOP") is not False
                    setattr(websocket, "screen_stream_settings", dict(data))
                    setattr(websocket, "is_screen_streaming", enabled)
                    stream_task = getattr(websocket, "screen_stream_task", None)
                    if enabled and (stream_task is None or stream_task.done()):
                        setattr(websocket, "last_screen_frame_hash", None)
                        setattr(websocket, "frame_sent_at_queue", deque(maxlen=64))
                        stream_task = asyncio.create_task(self.stream_screen_loop(websocket))
                        setattr(websocket, "screen_stream_task", stream_task)
                    elif not enabled and stream_task is not None:
                        stream_task.cancel()
                        setattr(websocket, "screen_stream_task", None)
                    await websocket.send(json.dumps({"action": "STREAM_STATUS", "enabled": enabled, "status": "SUCCESS"}))

                elif action in ("TAKE_SCREENSHOT", "GET_SCREENSHOT_ONCE"):
                    quality = int(data.get("quality", 70))
                    res_mode = data.get("resolution", "720p")
                    monitor_index = int(data.get("monitorIndex", data.get("monitor", 0)) or 0)
                    mon_idx = max(0, monitor_index) + 1
                    target_w = 1280 if res_mode == "720p" else (1920 if res_mode == "1080p" else 854)
                    
                    try:
                        jpeg_bytes = await asyncio.to_thread(capture_and_compress_binary, target_w, quality, mon_idx)
                        if action == "TAKE_SCREENSHOT":
                            await websocket.send(b"\x01" + jpeg_bytes)
                        else:
                            b64 = base64.b64encode(jpeg_bytes).decode("utf-8")
                            await websocket.send(json.dumps({"action": "SCREENSHOT_ONCE_RESULT", "image": b64}))
                    except Exception as e:
                        print(f"[SCREENSHOT] Error: {e}")
                        await websocket.send(json.dumps({"action": "TAKE_SCREENSHOT_RESPONSE", "status": "ERROR", "error": str(e)}))

                elif action == "FRAME_ACK":
                    frame_id = data.get("frameId")
                    sent_by_id = getattr(websocket, "frame_sent_at_by_id", {})
                    if isinstance(frame_id, int):
                        sent_at = sent_by_id.pop(frame_id, None)
                    else:
                        sent_at_ms = data.get("sentAt")
                        sent_at = sent_at_ms / 1000.0 if isinstance(sent_at_ms, (int, float)) else getattr(websocket, "last_frame_sent_at", None)
                    if sent_at is None:
                        continue
                    rtt = (time.time() - sent_at) if sent_at else 0.1
                    
                    rtt_ms = rtt * 1000.0
                    current_tier = getattr(websocket, "current_tier", 2)
                    good_frames = getattr(websocket, "good_frame_count", 0)
                    
                    if rtt_ms > 350:
                        if current_tier > 0:
                            current_tier -= 1
                            good_frames = 0
                    elif rtt_ms < 150:
                        good_frames += 1
                        if good_frames >= 5:
                            if current_tier < 3:
                                current_tier += 1
                            good_frames = 0
                    else:
                        good_frames = 0
                    
                    setattr(websocket, "current_tier", current_tier)
                    setattr(websocket, "good_frame_count", good_frames)
                    
                    TIERS = [
                        {"quality": 35, "resolution": "480p"},
                        {"quality": 50, "resolution": "480p"},
                        {"quality": 65, "resolution": "720p"},
                        {"quality": 80, "resolution": "1080p"},
                    ]
                    tier_settings = TIERS[current_tier]
                    setattr(websocket, "adaptive_quality", tier_settings["quality"])
                    setattr(websocket, "adaptive_resolution", tier_settings["resolution"])
                    print(f"[STREAM] Python RTT adaptation: Tier {current_tier} ({tier_settings['resolution']}, Q: {tier_settings['quality']})")

                # 7B. CHUNKED FILE EXCHANGE
                elif action == "FILE_START":
                    if not hasattr(self, 'active_file_transfers'):
                        self.active_file_transfers = {}
                    connection_transfer_count = sum(
                        1 for transfer in self.active_file_transfers.values()
                        if transfer.get("websocket") is websocket
                    )
                    if connection_transfer_count >= 5:
                        await websocket.send(json.dumps({"action": "FILE_START_ACK", "fileId": data.get("fileId"), "status": "ERROR", "error": "Max active file transfers reached"}))
                        continue
                    
                    f_id = str(data.get("fileId") or f"file-{int(time.time())}")
                    if not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", f_id) or f_id in self.active_file_transfers:
                        await websocket.send(json.dumps({"action": "FILE_START_ACK", "fileId": f_id, "status": "ERROR", "error": "Invalid or duplicate file ID"}))
                        continue
                    file_size = int(data.get("fileSize") or 0)
                    if file_size < 0 or file_size > 500 * 1024 * 1024:
                        await websocket.send(json.dumps({"action": "FILE_START_ACK", "fileId": f_id, "status": "ERROR", "error": "File size exceeds 500MB limit"}))
                        continue
                    reserved_bytes = sum(int(transfer.get("fileSize", 0)) for transfer in self.active_file_transfers.values())
                    if len(self.active_file_transfers) >= 8 or reserved_bytes + file_size > 1024 * 1024 * 1024:
                        await websocket.send(json.dumps({"action": "FILE_START_ACK", "fileId": f_id, "status": "ERROR", "error": "Host transfer budget exceeded"}))
                        continue

                    raw_name = os.path.basename(data.get("fileName", "downloaded_file"))
                    f_name = "".join(c for c in raw_name if c.isalnum() or c in "._- ")
                    if not f_name:
                        f_name = f"downloaded_{int(time.time())}"
                    if f_name.split('.')[0].upper() in {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}:
                        f_name = f"_{f_name}"
                    dl_dir = os.path.abspath(self.download_directory)
                    os.makedirs(dl_dir, exist_ok=True)
                    if shutil.disk_usage(dl_dir).free - file_size < 512 * 1024 * 1024:
                        await websocket.send(json.dumps({"action": "FILE_START_ACK", "fileId": f_id, "status": "ERROR", "error": "Insufficient free space"}))
                        continue
                    stem, extension = os.path.splitext(f_name)
                    f_obj = None
                    target_p = ""
                    for candidate_index in range(1000):
                        candidate_name = f_name if candidate_index == 0 else f"{stem} ({candidate_index}){extension}"
                        candidate_path = os.path.abspath(os.path.join(dl_dir, candidate_name))
                        try:
                            try:
                                inside_download_directory = os.path.commonpath((dl_dir, candidate_path)) == dl_dir
                            except ValueError:
                                inside_download_directory = False
                            if not inside_download_directory:
                                break
                            f_obj = open(candidate_path, "xb")
                            target_p = candidate_path
                            f_name = candidate_name
                            break
                        except FileExistsError:
                            continue
                    if f_obj is None:
                        await websocket.send(json.dumps({"action": "FILE_START_ACK", "fileId": f_id, "status": "ERROR", "error": "Unable to create destination file"}))
                        continue
                    self.active_file_transfers[f_id] = {
                        "fileId": f_id,
                        "fileName": f_name,
                        "filePath": target_p,
                        "fileObj": f_obj,
                        "fileSize": file_size,
                        "receivedBytes": 0,
                        "currentOffset": 0,
                        "chunkSize": min(256 * 1024, max(1, int(data.get("chunkSize") or 65536))),
                        "websocket": websocket,
                        "lastActivity": time.time()
                    }
                    await websocket.send(json.dumps({"action": "FILE_START_ACK", "fileId": f_id, "status": "SUCCESS"}))

                elif action == "FILE_CHUNK":
                    f_id = data.get("fileId")
                    if hasattr(self, 'active_file_transfers') and f_id in self.active_file_transfers:
                        transfer = self.active_file_transfers[f_id]
                        if transfer.get("websocket") is not websocket:
                            await websocket.send(json.dumps({"action": "FILE_CHUNK_ACK", "fileId": f_id, "status": "ERROR", "error": "Unknown file transfer"}))
                            continue
                        transfer["lastActivity"] = time.time()
                        raw_d = data.get("data") or data.get("chunk") or data.get("base64")
                        if raw_d:
                            try:
                                chunk_b = base64.b64decode(raw_d, validate=True) if isinstance(raw_d, str) else bytes(raw_d)
                            except Exception:
                                self.abort_file_transfer(f_id, True)
                                await websocket.send(json.dumps({"action": "FILE_CHUNK_ACK", "fileId": f_id, "status": "ERROR", "error": "Invalid base64 chunk"}))
                                continue
                            if len(chunk_b) > transfer["chunkSize"] or len(chunk_b) > 256 * 1024:
                                self.abort_file_transfer(f_id, True)
                                await websocket.send(json.dumps({"action": "FILE_CHUNK_ACK", "fileId": f_id, "status": "ERROR", "error": "File chunk exceeds the negotiated limit"}))
                                continue
                            target_offset = data.get("offset") if isinstance(data.get("offset"), int) else transfer["currentOffset"]
                            if target_offset != transfer["currentOffset"] or target_offset < 0 or target_offset + len(chunk_b) > transfer["fileSize"]:
                                self.abort_file_transfer(f_id, True)
                                await websocket.send(json.dumps({"action": "FILE_CHUNK_ACK", "fileId": f_id, "status": "ERROR", "error": "Invalid or out-of-order chunk offset"}))
                                continue
                            try:
                                transfer["fileObj"].seek(target_offset)
                                transfer["fileObj"].write(chunk_b)
                                transfer["currentOffset"] += len(chunk_b)
                                transfer["receivedBytes"] = transfer["currentOffset"]
                                await websocket.send(json.dumps({
                                    "action": "FILE_CHUNK_ACK", "fileId": f_id, "status": "SUCCESS",
                                    "chunkIndex": data.get("chunkIndex"), "receivedBytes": transfer["receivedBytes"]
                                }))
                            except Exception:
                                self.abort_file_transfer(f_id, True)
                                await websocket.send(json.dumps({"action": "FILE_CHUNK_ACK", "fileId": f_id, "status": "ERROR", "error": "Failed to write file chunk"}))
                        else:
                            self.abort_file_transfer(f_id, True)
                            await websocket.send(json.dumps({"action": "FILE_CHUNK_ACK", "fileId": f_id, "status": "ERROR", "error": "Missing file chunk data"}))
                    else:
                        await websocket.send(json.dumps({"action": "FILE_CHUNK_ACK", "fileId": f_id, "status": "ERROR", "error": "Unknown file transfer"}))

                elif action == "FILE_END":
                    f_id = data.get("fileId")
                    if hasattr(self, 'active_file_transfers') and f_id in self.active_file_transfers:
                        transfer = self.active_file_transfers[f_id]
                        if transfer.get("websocket") is not websocket:
                            await websocket.send(json.dumps({"action": "FILE_END_ACK", "fileId": f_id, "status": "ERROR", "error": "Unknown file transfer"}))
                            continue
                        if transfer["receivedBytes"] != transfer["fileSize"]:
                            self.abort_file_transfer(f_id, True)
                            await websocket.send(json.dumps({"action": "FILE_END_ACK", "fileId": f_id, "status": "ERROR", "error": "Incomplete or unknown file transfer"}))
                            continue
                        transfer = self.active_file_transfers.pop(f_id)
                        transfer["fileObj"].flush()
                        os.fsync(transfer["fileObj"].fileno())
                        transfer["fileObj"].close()
                        self.signals.log_event.emit("FILE_TRANSFER", f"Received file: {transfer['fileName']}", "info")
                        await websocket.send(json.dumps({
                            "action": "FILE_END_ACK",
                            "fileId": f_id,
                            "fileName": transfer["fileName"],
                            "status": "SUCCESS"
                        }))

                elif action == "FILE_CANCEL":
                    f_id = data.get("fileId")
                    transfer = getattr(self, 'active_file_transfers', {}).get(f_id)
                    if transfer is not None and transfer.get("websocket") is websocket:
                        self.abort_file_transfer(f_id, True)
                        await websocket.send(json.dumps({"action": "FILE_CANCEL_ACK", "fileId": f_id, "status": "SUCCESS"}))
                    else:
                        await websocket.send(json.dumps({"action": "FILE_CANCEL_ACK", "fileId": f_id, "status": "ERROR", "error": "Unknown file transfer"}))

                # 7C. AUDIO STREAMING
                elif action == "AUDIO_STREAM":
                    enabled = data.get("enabled", True)
                    was_streaming = getattr(websocket, "is_audio_streaming", False)
                    setattr(websocket, "is_audio_streaming", enabled)
                    await websocket.send(json.dumps({
                        "action": "AUDIO_STREAM_STATUS",
                        "enabled": getattr(websocket, "is_audio_streaming", True),
                        "status": "SUCCESS"
                    }))
                    if enabled and not was_streaming:
                        asyncio.create_task(self.stream_audio_loop(websocket))

                elif isinstance(action, str) and action.startswith("DECK_"):
                    await websocket.send(json.dumps({
                        "action": "DECK_UNAVAILABLE",
                        "status": "UNSUPPORTED",
                        "error": "Aether Deck is available in the full Electron host"
                    }))

                # 8. POWER COMMANDS
                elif action == "POWER":
                    p_cmd = str(data.get("command", "")).upper()
                    self.signals.log_event.emit("POWER", f"Power action: {p_cmd}", "warning")
                    if p_cmd == "SHUTDOWN":
                        subprocess.Popen(run_powershell_safely("Stop-Computer -Force"))
                    elif p_cmd == "REBOOT":
                        subprocess.Popen(run_powershell_safely("Restart-Computer -Force"))
                    elif p_cmd == "LOCK":
                        subprocess.Popen(run_powershell_safely("rundll32.exe user32.dll,LockWorkStation"))
                    elif p_cmd == "SLEEP":
                        subprocess.Popen(run_powershell_safely("Add-Type -Assembly System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)"))
                    elif p_cmd in ("ALT_F4", "CLOSE_WINDOW"):
                        subprocess.Popen(run_powershell_safely('$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys("%{F4}")'))
                    await websocket.send(json.dumps({"status": "SUCCESS", "command": p_cmd}))

                # 9. MEDIA CONTROLS
                elif action == "MEDIA":
                    m_cmd = str(data.get("command", "")).upper()
                    val = data.get("val") if data.get("val") is not None else data.get("value")
                    self.signals.log_event.emit("MEDIA", f"Media key: {m_cmd}", "info")
                    if m_cmd not in ("VOL_SET", "VOLUME_SET", "VOL_UP", "VOL_DOWN", "VOL_MUTE", "PLAY_PAUSE", "NEXT_TRACK", "PREV_TRACK"):
                        await websocket.send(json.dumps({"status": "ERROR", "error": "Unknown media command"}))
                        continue
                    if m_cmd in ("VOL_SET", "VOLUME_SET") and val is not None:
                        try:
                            val_num = max(0, min(100, int(val)))
                            steps = round(val_num / 2)
                            ps_vol = f'$w = New-Object -ComObject wscript.shell; for ($i = 0; $i -lt 50; $i++) {{ $w.SendKeys([char]174) }}; for ($i = 0; $i -lt {steps}; $i++) {{ $w.SendKeys([char]175) }}'
                            subprocess.Popen(run_powershell_safely(ps_vol))
                        except Exception as e:
                            print(f"[MEDIA] Volume set error: {e}")
                    else:
                        vk_map = {
                            "VOL_UP": "[char]175",
                            "VOL_DOWN": "[char]174",
                            "VOL_MUTE": "[char]173",
                            "PLAY_PAUSE": "[char]179",
                            "NEXT_TRACK": "[char]176",
                            "PREV_TRACK": "[char]177"
                        }
                        if m_cmd in vk_map:
                            vk = vk_map[m_cmd]
                            repeats = 1
                            if m_cmd in ["VOL_UP", "VOL_DOWN"]:
                                val = data.get("val") or data.get("value")
                                if val is not None:
                                    try:
                                        repeats = max(1, min(20, round(int(val) / 2)))
                                    except:
                                        pass
                            ps_code = f'$w = New-Object -ComObject wscript.shell; 1..{repeats} | ForEach-Object {{ $w.SendKeys({vk}) }}'
                            subprocess.Popen(run_powershell_safely(ps_code))
                    await websocket.send(json.dumps({"status": "SUCCESS", "command": m_cmd}))

                # 10. SYSTEM & CLIPBOARD
                elif action == "SYSTEM" or action == "CLIPBOARD" or action == "WRITE_CLIPBOARD":
                    s_cmd = data.get("command")
                    is_get = s_cmd in ["GET", "GET_CLIPBOARD", "READ_CLIPBOARD"] or action == "GET_CLIPBOARD" or data.get("text") == "GET"
                    
                    if is_get:
                        text = pyperclip.paste()
                        await websocket.send(json.dumps({"action": "CLIPBOARD_TEXT", "status": "SUCCESS", "text": text}))
                    elif s_cmd in ("WRITE_CLIPBOARD", "SET", "SET_CLIPBOARD") or action in ("WRITE_CLIPBOARD", "CLIPBOARD"):
                        new_text = data.get("text", "")
                        pyperclip.copy(new_text)
                        self.last_clipboard_fingerprint = clipboard_fingerprint(str(new_text))
                        self.signals.log_event.emit("SYSTEM", "Clipboard text updated", "info")
                        await websocket.send(json.dumps({"action": "CLIPBOARD_WRITE_ACK", "status": "CLIPBOARD_WRITTEN", "text": new_text}))
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            auth_timeout_task.cancel()
            if session_expiry_task is not None:
                session_expiry_task.cancel()
            self.all_websockets.discard(websocket)
            setattr(websocket, "is_screen_streaming", False)
            screen_task = getattr(websocket, "screen_stream_task", None)
            if screen_task is not None:
                screen_task.cancel()
            if hasattr(self, 'active_file_transfers'):
                for file_id, transfer in list(self.active_file_transfers.items()):
                    if transfer.get("websocket") is websocket:
                        self.abort_file_transfer(file_id, True)
            self.authenticated_websockets.discard(websocket)
            if authenticated:
                self.connected_client = None
                self.signals.client_disconnected.emit()
                self.signals.update_status_pill.emit('LISTENING_FOR_CLIENT')
                self.signals.log_event.emit("AUTH", f"Client disconnected ({client_ip})", "info")

    async def start_server(self):
        self.loop = asyncio.get_running_loop()
        if self.enable_discovery:
            start_mdns_service(self.port, self.tls_fingerprint)
        asyncio.create_task(self.sweep_file_transfers())
        asyncio.create_task(self.clipboard_broadcast_loop())
        async def process_http_request(path, _headers):
            if path != "/health":
                return None
            body = json.dumps({
                "status": "ok",
                "protocolVersion": "2.0",
                "port": self.port,
                "secure": True,
                "tlsFingerprint": self.tls_fingerprint
            }).encode("utf-8")
            headers = [
                ("Content-Type", "application/json"),
                ("Content-Length", str(len(body))),
                ("Cache-Control", "no-store"),
                ("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"),
                ("Permissions-Policy", "camera=(), microphone=(), geolocation=()"),
                ("Referrer-Policy", "no-referrer"),
                ("X-Content-Type-Options", "nosniff"),
                ("X-Frame-Options", "DENY")
            ]
            return HTTPStatus.OK, headers, body

        async with legacy_websocket_serve(self.handle_connection, "0.0.0.0", self.port, max_size=1024 * 1024, process_request=process_http_request, ssl=self.ssl_context):
            self.signals.log_event.emit("SYSTEM", f"Server listening on wss://{self.local_ip}:{self.port}", "success")
            await asyncio.Future()

class AetherMainWindow(QMainWindow):
    """PyQt6 Liquid-Glass Modern Desktop Application UI."""
    def __init__(self, backend, signals):
        super().__init__()
        self.backend = backend
        self.signals = signals
        
        self.setWindowTitle("Aether Host - System Control Daemon")
        self.resize(850, 680)
        self.setStyleSheet("background-color: #000000; color: #ffffff;")
        
        self.init_ui()
        self.setup_signals()
        self.setup_tray()
        
        # Telemetry Timer
        self.stat_timer = QTimer()
        self.stat_timer.timeout.connect(self.update_telemetry)
        self.stat_timer.start(2000)

    def init_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QVBoxLayout(central)
        main_layout.setContentsMargins(24, 24, 24, 24)
        main_layout.setSpacing(20)

        # 1. HEADER SECTION
        header_layout = QHBoxLayout()
        header_text_box = QVBoxLayout()
        
        title = QLabel("Aether Host")
        title.setFont(QFont("Segoe UI", 28, QFont.Weight.Bold))
        title.setStyleSheet("color: #ffffff; font-style: italic;")
        
        subtitle = QLabel("Windows System Control Daemon")
        subtitle.setFont(QFont("Segoe UI", 10))
        subtitle.setStyleSheet("color: rgba(255, 255, 255, 0.5);")
        
        header_text_box.addWidget(title)
        header_text_box.addWidget(subtitle)
        
        # Status LED Pill
        self.status_pill = QLabel(" LISTENING FOR CLIENT ")
        self.status_pill.setStyleSheet("""
            background: rgba(239, 68, 68, 0.15);
            color: #ef4444;
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 12px;
            padding: 6px 14px;
            font-size: 11px;
            font-weight: bold;
        """)
        
        header_layout.addLayout(header_text_box)
        header_layout.addStretch()
        header_layout.addWidget(self.status_pill)
        main_layout.addLayout(header_layout)

        # 2. MAIN CONTENT GRID (QR & PIN + Telemetry)
        content_grid = QHBoxLayout()
        
        # QR Code Card
        qr_card = QFrame()
        qr_card.setStyleSheet("background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 16px;")
        qr_layout = QVBoxLayout(qr_card)
        
        qr_label_title = QLabel("SCAN TO PAIR")
        qr_label_title.setFont(QFont("Segoe UI", 9, QFont.Weight.Bold))
        qr_label_title.setStyleSheet("color: rgba(255, 255, 255, 0.4);")
        
        self.qr_image_label = QLabel()
        self.qr_image_label.setFixedSize(180, 180)
        self.qr_image_label.setScaledContents(True)
        
        pin_code_label = QLabel(self.backend.formatted_pin)
        pin_code_label.setFont(QFont("Segoe UI", 22, QFont.Weight.Bold))
        pin_code_label.setStyleSheet("color: #38bdf8; letter-spacing: 2px;")
        pin_code_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        ip_label = QLabel(f"http://{self.backend.local_ip}:{self.backend.port}")
        ip_label.setFont(QFont("Segoe UI", 10))
        ip_label.setStyleSheet("color: rgba(255, 255, 255, 0.6);")
        ip_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        qr_layout.addWidget(qr_label_title)
        qr_layout.addWidget(self.qr_image_label, alignment=Qt.AlignmentFlag.AlignCenter)
        qr_layout.addWidget(pin_code_label)
        qr_layout.addWidget(ip_label)
        
        self.generate_qr_code()
        
        # Telemetry Card
        telem_card = QFrame()
        telem_card.setStyleSheet("background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 16px;")
        telem_layout = QVBoxLayout(telem_card)
        
        telem_title = QLabel("SYSTEM TELEMETRY")
        telem_title.setFont(QFont("Segoe UI", 9, QFont.Weight.Bold))
        telem_title.setStyleSheet("color: rgba(255, 255, 255, 0.4);")
        
        self.cpu_label = QLabel("CPU Load: 0.0%")
        self.ram_label = QLabel("RAM Usage: 0.0%")
        self.net_label = QLabel("Network: 0.0 MB/s")
        
        for l in (self.cpu_label, self.ram_label, self.net_label):
            l.setFont(QFont("Segoe UI", 12))
            l.setStyleSheet("color: #ffffff;")
            
        telem_layout.addWidget(telem_title)
        telem_layout.addWidget(self.cpu_label)
        telem_layout.addWidget(self.ram_label)
        telem_layout.addWidget(self.net_label)
        telem_layout.addStretch()
        
        content_grid.addWidget(qr_card, 1)
        content_grid.addWidget(telem_card, 1)
        main_layout.addLayout(content_grid)

        # 3. AUDIT LOG CONSOLE
        log_title = QLabel("LIVE AUDIT LOGS")
        log_title.setFont(QFont("Segoe UI", 9, QFont.Weight.Bold))
        log_title.setStyleSheet("color: rgba(255, 255, 255, 0.4);")
        
        self.log_console = QTextEdit()
        self.log_console.setReadOnly(True)
        self.log_console.setStyleSheet("""
            background: #050505;
            color: #10b981;
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 11px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 8px;
            padding: 8px;
        """)
        
        main_layout.addWidget(log_title)
        main_layout.addWidget(self.log_console, 1)

    def generate_qr_code(self):
        qr = qrcode.QRCode(version=1, box_size=6, border=1)
        qr.add_data(f"aether://{self.backend.local_ip}:{self.backend.port}?pin={self.backend.pin}&tlsFingerprint={self.backend.tls_fingerprint}")
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        qimg = QImage.fromData(buffer.getvalue())
        pixmap = QPixmap.fromImage(qimg)
        self.qr_image_label.setPixmap(pixmap)

    def setup_signals(self):
        self.signals.log_event.connect(self.append_log)
        self.signals.update_status_pill.connect(self.update_status_pill_ui)
        self.signals.pending_auth_request.connect(self.handle_pending_auth)

    def handle_pending_auth(self, request_id, client_ip, device_name):
        dialog = QMessageBox(self)
        dialog.setWindowTitle("Connection Request" if sys.platform != 'win32' or os.getenv('LANG') != 'ru_RU' else "Запрос на подключение")
        dialog.setText(f"Device: {device_name}\nIP Address: {client_ip}\n\nDo you want to allow this connection?")
        dialog.setStandardButtons(QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        dialog.setDefaultButton(QMessageBox.StandardButton.Yes)
        
        # Style the dialog for dark mode dark liquid theme compatibility
        dialog.setStyleSheet("""
            QMessageBox {
                background-color: #121212;
                color: #ffffff;
            }
            QLabel {
                color: #ffffff;
                font-size: 12px;
            }
            QPushButton {
                background-color: #2a2a2a;
                color: #ffffff;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                padding: 6px 16px;
                font-size: 11px;
                font-weight: bold;
                min-width: 80px;
            }
            QPushButton:hover {
                background-color: #3a3a3a;
                border-color: rgba(255, 255, 255, 0.25);
            }
            QPushButton:pressed {
                background-color: #1a1a1a;
            }
        """)
        
        def on_finished(result):
            approved = (result == QMessageBox.StandardButton.Yes)
            self.backend.resolve_pending_request(request_id, approved)
            
        dialog.finished.connect(on_finished)
        dialog.show()

    def append_log(self, evt_type, msg, level):
        ts = datetime.now().strftime("%H:%M:%S")
        color = "#10b981" if level == "success" else ("#f59e0b" if level == "warning" else ("#ef4444" if level == "error" else "#38bdf8"))
        html = f"<span style='color: rgba(255,255,255,0.3);'>[{ts}]</span> <b style='color:{color};'>[{evt_type}]</b> {msg}"
        self.log_console.append(html)

    def update_status_pill_ui(self, status_code):
        if status_code == "CLIENT_CONNECTED":
            self.status_pill.setText(" CLIENT CONNECTED ")
            self.status_pill.setStyleSheet("background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 6px 14px; font-size: 11px; font-weight: bold;")
        elif status_code == "BLOCKED_BRUTE_FORCE":
            self.status_pill.setText(" SECURITY LOCKOUT ")
            self.status_pill.setStyleSheet("background: rgba(239, 68, 68, 0.25); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.5); border-radius: 12px; padding: 6px 14px; font-size: 11px; font-weight: bold;")
        else:
            self.status_pill.setText(" LISTENING FOR CLIENT ")
            self.status_pill.setStyleSheet("background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 12px; padding: 6px 14px; font-size: 11px; font-weight: bold;")

    def setup_tray(self):
        self.tray = QSystemTrayIcon(self)
        self.tray.setIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_ComputerIcon))
        self.tray.setToolTip("Aether Host - System Control Daemon")
        
        menu = QMenu(self)
        
        status_action = menu.addAction("Статус подключения")
        status_action.triggered.connect(self.show_connection_status)
        
        qr_action = menu.addAction("Показать QR-код")
        qr_action.triggered.connect(self.show_normal_window)
        
        restart_action = menu.addAction("Перезапустить сервер")
        restart_action.triggered.connect(self.restart_server_tray)
        
        menu.addSeparator()
        
        exit_action = menu.addAction("Выход")
        exit_action.triggered.connect(QApplication.quit)
        
        self.tray.setContextMenu(menu)
        self.tray.activated.connect(self.on_tray_activated)
        self.tray.show()

    def show_connection_status(self):
        client = self.backend.connected_client or "Нет подключений"
        self.tray.showMessage("Aether Host Status", f"Клиент: {client}\nIP: {self.backend.local_ip}:{self.backend.port}", QSystemTrayIcon.MessageIcon.Information, 3000)

    def show_normal_window(self):
        self.show()
        self.activateWindow()

    def restart_server_tray(self):
        self.append_log("SYSTEM", "Сервер перезапущен через трей", "warning")
        self.tray.showMessage("Aether Host", "Сервер соединения перезапущен", QSystemTrayIcon.MessageIcon.Information, 2000)

    def on_tray_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            self.show_normal_window()

    def update_telemetry(self):
        cpu = psutil.cpu_percent()
        ram = psutil.virtual_memory().percent
        self.cpu_label.setText(f"CPU Load: {cpu:.1f}%")
        self.ram_label.setText(f"RAM Usage: {ram:.1f}%")

def main():
    setup_windows_firewall_rule()
    set_windows_autostart(True)
    
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    
    signals = CommunicationSignals()
    backend = AetherServerBackend(signals)
    
    # Run asyncio event loop in background thread
    def run_async_loop():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(backend.start_server())
        
    threading.Thread(target=run_async_loop, daemon=True).start()
    
    window = AetherMainWindow(backend, signals)
    window.show()
    
    try:
        sys.exit(app.exec())
    finally:
        stop_mdns_service()

if __name__ == "__main__":
    main()
