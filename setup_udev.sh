#!/usr/bin/env bash
# ==============================================================================
# Instalador de Reglas udev para Attack Shark X11 en Linux
# ==============================================================================

set -e

RULES_FILE="99-attack-shark-x11.rules"
DEST_PATH="/etc/udev/rules.d/$RULES_FILE"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Configuración de permisos udev para Attack Shark X11 ==="

if [ "$EUID" -ne 0 ]; then
    echo "Instalando con privilegios de administrador (sudo)..."
    sudo cp "$SCRIPT_DIR/$RULES_FILE" "$DEST_PATH"
    sudo udevadm control --reload-rules
    sudo udevadm trigger
else
    cp "$SCRIPT_DIR/$RULES_FILE" "$DEST_PATH"
    udevadm control --reload-rules
    udevadm trigger
fi

echo "¡Listo! Reglas instaladas en $DEST_PATH"
echo "Desconecta y vuelve a conectar el receptor 2.4G o el cable USB de tu mouse para aplicar los permisos de inmediato."
