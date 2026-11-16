#!/usr/bin/env python3
"""
Attack Shark X11 - Controlador Nativo de Línea de Comandos para Linux
Permite consultar y cambiar DPI, Polling Rate e Iluminación RGB desde la terminal.

Protocolo verificado contra el descriptor HID real y la documentación de la
comunidad. Las lecturas usan el permiso de un solo uso (0xA0) y se espacian
para no dejar el ratón sin responder.
"""

import sys
import os
import glob
import fcntl
import argparse
import time

VID = 0x1D57
PID_WIRELESS = 0xFA60
PID_WIRED = 0xFA61
PID_WIRED_ALT = 0x2124

REPORT_DPI = 0x04
REPORT_LIGHTING = 0x05
REPORT_POLLING = 0x06
REPORT_BUTTON_MAPPING = 0x08
REPORT_PERMISSION = 0xA0

READ_LENGTHS = {
    REPORT_DPI: 0x38,
    REPORT_LIGHTING: 0x0F,
    REPORT_POLLING: 0x09,
    REPORT_BUTTON_MAPPING: 0x3B,
}

HIDIOCGRAWINFO = 0x80084803


def _IOC(dir_flag, group_char, nr, size):
    return (dir_flag << 30) | (ord(group_char) << 8) | nr | (size << 16)


def HIDIOCSFEATURE(length):
    return _IOC(3, 'H', 0x06, length)


def HIDIOCGFEATURE(length):
    return _IOC(3, 'H', 0x07, length)


def calculate_checksum(data, start=0, end=None):
    if end is None:
        end = len(data) - 2
    total = sum(data[start:end]) & 0xFFFF
    return (total >> 8) & 0xFF, total & 0xFF


# Tabla no lineal del sensor PAW3311. Índices 0..199 -> 50..10000 (paso 50).
# Índices 200..219 -> 10100..12000 (paso 100).
DPI_3311 = [
    int(v, 16) for v in (
        "01,02,03,04,05,06,08,09,0a,0b,0c,0e,0f,10,11,12,13,15,16,17,18,19,1b,"
        "1c,1d,1e,1f,20,22,23,24,25,26,27,29,2a,2b,2c,2d,2f,30,31,32,33,34,36,"
        "37,38,39,3a,3b,3d,3e,3f,40,41,43,44,45,46,47,48,4a,4b,4c,4d,4e,4f,51,"
        "52,53,54,55,57,58,59,5a,5b,5c,5e,5f,60,61,62,63,65,66,67,68,69,6b,6c,"
        "6d,6e,6f,70,72,73,74,75,76,77,79,7a,7b,7c,7d,7f,80,81,82,83,84,86,87,"
        "88,89,8a,8b,8d,8e,8f,90,91,93,94,95,96,97,98,9a,9b,9c,9d,9e,9f,a1,a2,"
        "a3,a4,a5,a7,a8,a9,aa,ab,ac,ae,af,b0,b1,b2,b3,b5,b6,b7,b8,b9,bb,bc,bd,"
        "be,bf,c0,c2,c3,c4,c5,c6,c7,c9,ca,cb,cc,cd,cf,d0,d1,d2,d3,d4,d6,d7,d8,"
        "d9,da,db,dd,de,df,e0,e1,e3,e4,e5,e6,e7,e8,ea,eb,76,77,79,7a,7b,7c,7d,"
        "7f,80,81,82,83,84,86,87,88,89,8a,8b,8d"
    ).split(",")
]


def encode_dpi(value):
    """Devuelve (low, high, double, triple) para el Report 0x04."""
    dpi = max(50, int(round(value)))
    double = False
    triple = False

    if 24100 <= dpi <= 25000:
        triple = True
        dpi = max(8000, min(8500, int(round(dpi / 3))))
    elif dpi > 24000:
        dpi = 8500
    elif dpi > 12000:
        double = True
        dpi = int(round(dpi / 2))

    if dpi <= 10000:
        dpi = max(50, min(10000, int(round(dpi / 50)) * 50))
        high = 0
        low = DPI_3311[(dpi - 50) // 50]
    else:
        dpi = max(10100, min(12000, int(round(dpi / 100)) * 100))
        high = 1
        low = DPI_3311[200 + (dpi - 10100) // 100]

    return low, high, double, triple


def find_shark_device():
    """Busca el /dev/hidraw del canal de configuración (Usage Page 0x000B)."""
    candidates = []
    for path in sorted(glob.glob("/sys/class/hidraw/hidraw*"), reverse=True):
        dev_name = os.path.basename(path)
        uevent_path = os.path.join(path, "device", "uevent")
        desc_path = os.path.join(path, "device", "report_descriptor")

        if not os.path.exists(uevent_path):
            continue

        with open(uevent_path, "r", encoding="utf-8", errors="ignore") as f:
            uevent = f.read()

        if "00001D57:0000FA60" in uevent or "00001D57:0000FA61" in uevent or "00001D57:00002124" in uevent:
            dev_path = f"/dev/{dev_name}"
            is_config_channel = False
            if os.path.exists(desc_path):
                with open(desc_path, "rb") as df:
                    if b"\x05\x0b" in df.read():
                        is_config_channel = True
            candidates.append((dev_path, is_config_channel, uevent))

    for dev_path, is_config, uevent in candidates:
        if is_config:
            return dev_path, uevent
    if candidates:
        return candidates[0][0], candidates[0][2]
    return None, None


def send_feature_report(fd, report_bytes):
    """HIDIOCSFEATURE incluye el Report ID como primer byte."""
    buf = bytearray(report_bytes)
    fcntl.ioctl(fd, HIDIOCSFEATURE(len(buf)), buf)


def receive_feature_report(fd, report_id, length):
    """HIDIOCGFEATURE: el búfer incluye el Report ID y tiene `length` bytes."""
    buf = bytearray([report_id] + [0] * (length - 1))
    fcntl.ioctl(fd, HIDIOCGFEATURE(length), buf)
    return bytearray(buf)


def read_report(fd, report_id, length, parameter=0x01):
    """
    Handshake de lectura: SET_REPORT 0xA0, esperar, GET_REPORT 0xA0 y
    comprobar que el firmware autorizó (byte 1 == 0x01).
    """
    trigger = bytearray([REPORT_PERMISSION, report_id, length, 0x00, parameter, 0x00, 0x00, 0x00])
    send_feature_report(fd, trigger)
    time.sleep(0.25)

    auth = receive_feature_report(fd, REPORT_PERMISSION, 8)
    if len(auth) < 2 or auth[1] != 0x01:
        raise RuntimeError(f"permiso de lectura denegado para el reporte 0x{report_id:02X}")

    data = receive_feature_report(fd, report_id, length)
    time.sleep(0.10)
    return data


def cmd_status(args):
    dev_path, uevent = find_shark_device()
    if not dev_path:
        print("[-] No se encontró ningún mouse Attack Shark X11 conectado.")
        return 1

    is_wireless = "FA60" in uevent
    mode_str = "Inalámbrico 2.4GHz (Dongle)" if is_wireless else "Cable USB Directo"
    print(f"[+] Attack Shark X11 detectado en: {dev_path}")
    print(f"    Modo de conexión: {mode_str}")

    try:
        fd = os.open(dev_path, os.O_RDWR)
    except PermissionError:
        print("\n[!] Permiso denegado al acceder a /dev/hidraw*")
        print("    Ejecuta una vez: sudo ./setup_udev.sh para configurar acceso sin root.")
        return 1

    try:
        poll_data = read_report(fd, REPORT_POLLING, READ_LENGTHS[REPORT_POLLING])
        code = poll_data[3]
        rates = {0x01: 1000, 0x02: 500, 0x04: 250, 0x08: 125}
        hz = rates.get(code, "Desconocido")
        print(f"    Tasa de Sondeo:   {hz} Hz")
        print("    Batería:          se recibe por eventos asíncronos (no por Feature Report)")
    except Exception as e:
        print(f"[!] Error leyendo telemetría: {e}")
    finally:
        os.close(fd)
    return 0


def cmd_polling(args):
    rate = args.rate
    rates = {
        125:  (0x08, 0xF7),
        250:  (0x04, 0xFB),
        500:  (0x02, 0xFD),
        1000: (0x01, 0xFE)
    }
    if rate not in rates:
        print("[-] Tasa inválida. Usa 125, 250, 500 o 1000.")
        return 1

    code, inv = rates[rate]
    # [0]=0x06 [1]=0x09 [2]=profile [3]=code [4]=~code [5..8]=0
    packet = bytearray([0x06, 0x09, 0x01, code, inv, 0x00, 0x00, 0x00, 0x00])

    dev_path, _ = find_shark_device()
    if not dev_path:
        print("[-] Ratón no encontrado.")
        return 1

    try:
        fd = os.open(dev_path, os.O_RDWR)
        send_feature_report(fd, packet)
        os.close(fd)
        print(f"[+] Tasa de sondeo establecida exitosamente a {rate} Hz")
    except PermissionError:
        print("[!] Permiso denegado. Ejecuta sudo ./setup_udev.sh")
        return 1
    return 0


def cmd_rgb(args):
    mode = max(0, min(6, args.mode))
    brightness = max(1, min(8, args.brightness))
    speed = max(1, min(5, args.speed))

    color_hex = args.color.lstrip("#")
    if len(color_hex) == 6:
        r = int(color_hex[0:2], 16)
        g = int(color_hex[2:4], 16)
        b = int(color_hex[4:6], 16)
    else:
        r, g, b = 255, 0, 80

    deep_sleep = 0x0A  # valor por defecto del firmware
    sleep_min = 5
    response_ms = 4

    packet = bytearray(15)
    packet[0] = REPORT_LIGHTING
    packet[1] = 0x0F
    packet[2] = 0x01
    packet[3] = (mode << 4) & 0xF0
    packet[4] = (deep_sleep & 0xF0) | (speed & 0x0F)
    packet[5] = ((deep_sleep & 0x0F) << 4) | (brightness & 0x0F)
    packet[6] = r
    packet[7] = g
    packet[8] = b
    packet[9] = max(1, min(60, round(sleep_min * 2)))
    packet[10] = max(2, min(25, round(response_ms / 2)))

    chk_hi, chk_lo = calculate_checksum(packet, 3, 11)
    packet[11] = chk_hi
    packet[12] = chk_lo
    packet[13] = 0x00
    packet[14] = 0x00

    dev_path, _ = find_shark_device()
    if not dev_path:
        print("[-] Ratón no encontrado.")
        return 1

    try:
        fd = os.open(dev_path, os.O_RDWR)
        send_feature_report(fd, packet)
        os.close(fd)
        print(f"[+] Iluminación RGB aplicada: Modo {mode}, Color #{r:02x}{g:02x}{b:02x}, Brillo {brightness}, Velocidad {speed}")
    except PermissionError:
        print("[!] Permiso denegado. Ejecuta sudo ./setup_udev.sh")
        return 1
    return 0


def cmd_dpi(args):
    target_dpi = max(50, min(25000, args.dpi))
    low, high, double, triple = encode_dpi(target_dpi)

    packet = bytearray(56)
    packet[0] = REPORT_DPI
    packet[1] = 0x38
    packet[2] = 0x01
    packet[3] = 0x00  # LOD 1 mm, angle snap off
    packet[4] = 0x10  # motion sync on, ripple off
    packet[5] = 0x01  # solo la etapa 1 activa
    packet[6] = 0x01 if double else 0x00
    packet[7] = 0x01 if triple else 0x00
    packet[8] = low
    packet[16] = high
    packet[24] = 0x01  # etapa activa 1-based
    packet[25] = 0xFF  # color de la etapa 1: rojo
    packet[26] = 0x00
    packet[27] = 0x00
    packet[49] = 0x02  # indicador DPI fijo

    chk_hi, chk_lo = calculate_checksum(packet, 3, 50)
    packet[50] = chk_hi
    packet[51] = chk_lo

    dev_path, _ = find_shark_device()
    if not dev_path:
        print("[-] Ratón no encontrado.")
        return 1

    try:
        fd = os.open(dev_path, os.O_RDWR)
        send_feature_report(fd, packet)
        os.close(fd)
        print(f"[+] DPI configurado exitosamente a {target_dpi} DPI")
        if target_dpi > 12000:
            print("    Nota: el firmware usa escala doble/triple para valores altos.")
    except PermissionError:
        print("[!] Permiso denegado. Ejecuta sudo ./setup_udev.sh")
        return 1
    return 0


def main():
    parser = argparse.ArgumentParser(description="Attack Shark X11 Linux Driver CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("status", help="Muestra el estado de conexión y la tasa de sondeo")
    subparsers.add_parser("info", help="Alias de status")

    p_poll = subparsers.add_parser("polling", help="Configura la tasa de sondeo en Hz (125, 250, 500, 1000)")
    p_poll.add_argument("rate", type=int, choices=[125, 250, 500, 1000], help="Frecuencia en Hz")

    p_dpi = subparsers.add_parser("dpi", help="Configura la sensibilidad DPI (50 - 25000)")
    p_dpi.add_argument("dpi", type=int, help="Valor de DPI")

    p_rgb = subparsers.add_parser("rgb", help="Configura los efectos de iluminación RGB")
    p_rgb.add_argument("--mode", type=int, default=1, choices=range(7), help="Modo 0-6 (0=Apagado, 1=Estático, 2=Respiración...)")
    p_rgb.add_argument("--color", type=str, default="#ff0055", help="Color en formato hexadecimal (#rrggbb)")
    p_rgb.add_argument("--brightness", type=int, default=5, choices=range(1, 9), help="Brillo 1-8")
    p_rgb.add_argument("--speed", type=int, default=4, choices=range(1, 6), help="Velocidad de efecto 1-5")

    args = parser.parse_args()
    if args.command in ("status", "info"):
        sys.exit(cmd_status(args))
    elif args.command == "polling":
        sys.exit(cmd_polling(args))
    elif args.command == "dpi":
        sys.exit(cmd_dpi(args))
    elif args.command == "rgb":
        sys.exit(cmd_rgb(args))


if __name__ == "__main__":
    main()
