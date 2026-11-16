# Contribuir

[English](CONTRIBUTING.md) | **Español**

Gracias por querer mejorar el soporte del Attack Shark X11 en Linux.

## Antes de empezar

- Este proyecto habla directamente con el firmware del ratón. Un paquete
  incorrecto puede dejar el dispositivo sin responder hasta reconectarlo.
- No envíes el reporte `0x10` (modo bootloader).
- Si vas a cambiar el protocolo, actualiza también
  [`REVERSE_ENGINEERING.es.md`](REVERSE_ENGINEERING.es.md) y las pruebas manuales
  descritas allí.

## Entorno de desarrollo

```bash
git clone https://github.com/Alan-sastre/attack-shark-x11-linux.git
cd attack-shark-x11-linux
sudo ./setup_udev.sh
./run.sh
```

Requisitos:

- Linux con `udev`
- Python 3.10 o superior
- Navegador basado en Chromium con WebHID (Helium, Chrome, Chromium, Brave o Edge)

## Comprobaciones antes de un pull request

```bash
node --check js/protocol.js
node --check js/webhid.js
node --check js/app.js
python3 -m py_compile shark_ctl.py server.py
bash -n run.sh setup_udev.sh install.sh
```

Si has probado con hardware real, indica el modelo, el PID y qué comandos
ejecutaste. No adjuntes volcados que contengan datos personales.

## Estilo de commits

Se recomienda [Conventional Commits](https://www.conventionalcommits.org/es/):

- `feat:` nueva funcionalidad
- `fix:` corrección de errores
- `docs:` documentación
- `style:` formato o estilos
- `refactor:` cambios internos sin alterar comportamiento
- `test:` pruebas
- `build:` scripts, dependencias o empaquetado
- `ci:` integración continua
- `chore:` mantenimiento

Ejemplo:

```text
fix(webhid): serializar lecturas y esperar el permiso 0xA0
```

## Licencia

Al contribuir aceptas que tu aporte se publique bajo la licencia MIT del
proyecto.
