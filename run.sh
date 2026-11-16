#!/usr/bin/env bash
# ==============================================================================
# Lanzador de Attack Shark X11 Linux Driver
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Verificar si las reglas udev ya están instaladas
if [ ! -f "/etc/udev/rules.d/99-attack-shark-x11.rules" ]; then
    echo "======================================================================"
    echo "  AVISO: Reglas udev no encontradas en /etc/udev/rules.d/"
    echo "  Para que WebHID o Python tengan acceso directo al ratón sin root,"
    echo "  se recomienda ejecutar una vez:"
    echo "      sudo ./setup_udev.sh"
    echo "======================================================================"
    echo ""
fi

# Iniciar servidor y abrir aplicación
exec python3 "$SCRIPT_DIR/server.py"
