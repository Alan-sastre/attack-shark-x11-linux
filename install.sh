#!/usr/bin/env bash
# ==============================================================================
# Instalador de Attack Shark X11 para Linux
# Instala las reglas udev y el acceso directo del menú de aplicaciones.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_FILE="$DESKTOP_DIR/attack-shark-x11.desktop"

if [ "$EUID" -eq 0 ]; then
    echo "No ejecutes este instalador con sudo." >&2
    echo "Ejecuta ./install.sh como tu usuario; solo se pedirá sudo para udev." >&2
    exit 1
fi

echo "=== Instalando Attack Shark X11 Control Center ==="

# 1. Reglas udev: permiten acceder a los hidraw sin ejecutar la app como root.
if [ ! -f "/etc/udev/rules.d/99-attack-shark-x11.rules" ]; then
    "$SCRIPT_DIR/setup_udev.sh"
else
    echo "[i] Las reglas udev ya están instaladas."
fi

# 2. Acceso directo con rutas absolutas del directorio actual.
if [ ! -f "$SCRIPT_DIR/Attack-Shark-X11.desktop" ]; then
    echo "[!] No se encontró Attack-Shark-X11.desktop" >&2
    exit 1
fi

mkdir -p "$DESKTOP_DIR"
sed "s|@PROJECT_DIR@|$SCRIPT_DIR|g" \
    "$SCRIPT_DIR/Attack-Shark-X11.desktop" \
    > "$DESKTOP_FILE"
chmod 644 "$DESKTOP_FILE"

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

chmod +x "$SCRIPT_DIR/run.sh" "$SCRIPT_DIR/setup_udev.sh" "$SCRIPT_DIR/shark_ctl.py" 2>/dev/null || true

echo "[+] Acceso directo instalado en: $DESKTOP_FILE"
echo "[+] Puedes abrir \"Attack Shark X11 Control Center\" desde el menú de aplicaciones."
echo "[+] O ejecutar: $SCRIPT_DIR/run.sh"
echo
echo "Si el ratón no aparece, desconecta y vuelve a conectar el receptor 2.4G."
