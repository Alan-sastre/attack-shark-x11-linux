#!/usr/bin/env python3
"""
Attack Shark X11 - Servidor Local del Controlador WebHID
Inicia un servidor web local y abre la aplicación en Helium Browser o Chrome.
"""

import http.server
import socketserver
import webbrowser
import os
import sys
import subprocess

PORT = 8088
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
        
    def log_message(self, format, *args):
        # Silenciar logs ruidosos en la terminal
        pass

def launch_browser(url):
    # Priorizar Helium browser si está presente
    helium_path = "/usr/bin/helium-browser"
    if os.path.exists(helium_path):
        try:
            subprocess.Popen([helium_path, f"--app={url}"])
            return
        except Exception:
            pass

    # Intentar google-chrome o chromium con modo app
    for browser in ["google-chrome", "chromium", "brave-browser", "microsoft-edge"]:
        try:
            subprocess.Popen([browser, f"--app={url}"])
            return
        except FileNotFoundError:
            continue

    # Fallback al navegador predeterminado
    webbrowser.open(url)

def main():
    os.chdir(DIRECTORY)
    
    # Intentar bindear el puerto
    port = PORT
    for _ in range(10):
        try:
            httpd = socketserver.TCPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            port += 1
            
    url = f"http://127.0.0.1:{port}/index.html"
    print("=" * 65)
    print("  Attack Shark X11 - Linux Control Center (WebHID)")
    print("=" * 65)
    print(f"[+] Servidor activo en: {url}")
    print("[+] Abriendo interfaz gráfica en el navegador...")
    print("[i] Presiona Ctrl + C en esta terminal para detener el servidor.")
    print("=" * 65)

    launch_browser(url)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[+] Servidor detenido correctamente.")
        sys.exit(0)

if __name__ == "__main__":
    main()
