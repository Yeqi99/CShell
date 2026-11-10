"""Private newline-delimited stdin/stdout transport for one authenticated RDP session."""
import asyncio
import base64
import hashlib
import io
import json
import logging
import sys
import winreg
from urllib.parse import quote

from aardwolf.commons.factory import RDPConnectionFactory
from aardwolf.commons.iosettings import RDPIOSettings
from aardwolf.commons.queuedata.constants import MOUSEBUTTON
from aardwolf.connection import RDPConnection
from aardwolf.network.x224 import X224Network
from aardwolf.protocol.x224.constants import SUPP_PROTOCOLS

def reply(result):
    print(json.dumps(result, separators=(",", ":")), flush=True)

def read():
    line = sys.stdin.buffer.readline(131072)
    if not line:
        return None
    return json.loads(line)

async def checked(operation):
    _, error = await operation
    if error:
        raise error

async def main():
    profile = read()
    host = profile["host"]
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                        r"Software\Microsoft\Terminal Server Client\Servers" + "\\" + host) as key:
        pin = winreg.QueryValueEx(key, "CertHash")[0]
    negotiate = X224Network.client_negotiate

    async def require_nla(network, *args, **kwargs):
        result, error = await negotiate(network, *args, **kwargs)
        if error:
            raise error
        if getattr(result.rdpNegData, "selectedProtocol", None) != SUPP_PROTOCOLS.HYBRID:
            raise ValueError("Server did not negotiate NLA")
        return result, None

    X224Network.client_negotiate = require_nla
    authenticate = RDPConnection.credssp_auth

    async def authenticate_pinned(connection):
        cert = connection._RDPConnection__connection.get_peer_certificate()
        if hashlib.new({20: "sha1", 32: "sha256"}[len(pin)], cert).digest() != pin:
            raise ValueError("RDP certificate mismatch")
        return await authenticate(connection)

    RDPConnection.credssp_auth = authenticate_pinned
    settings = RDPIOSettings()
    settings.channels = []
    settings.clipboard_use_pyperclip = False
    settings.supported_protocols = SUPP_PROTOCOLS.HYBRID
    settings.video_bpp_max = 32
    endpoint = f"[{host}]" if ":" in host and not host.startswith("[") else host
    url = ("rdp+ntlm-password://" + quote(profile["username"], safe="") + ":" +
           quote(profile["password"], safe="") + "@" + endpoint + ":" + str(profile["port"]))
    conn = RDPConnectionFactory.from_url(url, settings).get_connection(settings)
    try:
        await checked(conn.connect())
        while not conn.desktop_buffer_has_data:
            await asyncio.sleep(0.05)
        reply({"ready": True})
        while True:
            incoming = asyncio.create_task(asyncio.to_thread(read))
            disconnected = asyncio.create_task(conn.disconnected_evt.wait())
            await asyncio.wait([incoming, disconnected], return_when=asyncio.FIRST_COMPLETED)
            if disconnected.done():
                reply({"error": "RDP disconnected"})
                return
            disconnected.cancel()
            args = await incoming
            if args is None or conn.disconnected_evt.is_set():
                break
            action = args["action"]
            if action == "capture":
                frame = conn.get_desktop_buffer().convert("RGB")
                width = min(frame.width, args["maxWidth"])
                frame.thumbnail((width, 1920))
                out = io.BytesIO()
                frame.save(out, "JPEG", quality=args["quality"])
                data = out.getvalue()
                reply(dict(mimeType="image/jpeg", dataBase64=base64.b64encode(data).decode(),
                           width=frame.width, height=frame.height, target=profile["id"],
                           frameId=hashlib.sha256(data).hexdigest()))
            elif action == "key":
                modifiers = {"ctrl": (29, False), "shift": (42, False), "alt": (56, False), "win": (91, True)}
                pressed = []
                try:
                    for name in dict.fromkeys(args["modifiers"]):
                        key = modifiers[name]
                        pressed.append(key)
                        await checked(conn.send_key_scancode(key[0], True, key[1]))
                    key = (args["scanCode"], args["extended"])
                    pressed.append(key)
                    await checked(conn.send_key_scancode(key[0], True, key[1]))
                finally:
                    failure = None
                    for code, extended in reversed(pressed):
                        try:
                            await checked(conn.send_key_scancode(code, False, extended))
                        except Exception as error:
                            failure = error
                    if failure:
                        raise failure
                reply({"sent": True})
            elif action == "text":
                for unit in args["text"]:
                    await checked(conn.send_key_char(unit, True))
                    await checked(conn.send_key_char(unit, False))
                reply({"sent": True})
            elif action == "click":
                width, height = conn.get_desktop_buffer().size
                button = MOUSEBUTTON["MOUSEBUTTON_" + args["button"].upper()]
                x, y = round(args["x"] * (width - 1)), round(args["y"] * (height - 1))
                await checked(conn.send_mouse(button, x, y, True))
                await checked(conn.send_mouse(button, x, y, False))
                reply({"sent": True})
            else:
                raise ValueError("Unknown action")
    finally:
        await conn.terminate()

if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    try:
        asyncio.run(main())
    except Exception as exc:
        import traceback
        trace = traceback.extract_tb(exc.__traceback__)[-1]
        from pathlib import Path
        detail = exc.name if isinstance(exc, ModuleNotFoundError) else type(exc).__name__
        if isinstance(exc, FileNotFoundError) and exc.filename:
            detail += " " + Path(exc.filename).name
        detail += " " + ",".join(Path(t.filename).name + ":" + str(t.lineno) for t in traceback.extract_tb(exc.__traceback__)[-6:])
        reply({"error": f"RDP failed ({detail}, {trace.name}:{trace.lineno}). Check host trust, transport and credentials."})
        sys.exit(1)
