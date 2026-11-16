# Seguridad

[English](SECURITY.md) | **Español**

## Alcance

Esta aplicación envía Feature Reports al firmware del Attack Shark X11. Aunque
el protocolo está documentado y las operaciones se serializan, existe riesgo de
dejar el dispositivo bloqueado si se envían paquetes mal formados.

## Prácticas seguras

- No envíes el reporte `0x10`: está relacionado con el modo bootloader.
- No leas ni escribas reportes cuyo formato no esté documentado.
- Respeta el handshake de permiso `0xA0` y el espaciado mínimo entre comandos.
- Si el ratón deja de responder, desconecta y vuelve a conectar el receptor
  2.4G. En modelos con Bluetooth, cambia brevemente a Bluetooth y vuelve a 2.4G.

## Reportar una vulnerabilidad

No publiques detalles explotables en un issue abierto. Usa el canal privado de
seguridad de GitHub del repositorio o contacta con los mantenedores. Incluye:

- versión del proyecto,
- sistema operativo y navegador,
- PID del dispositivo,
- pasos para reproducirlo,
- impacto observado.

Las cuestiones puramente de compatibilidad de hardware pueden tratarse en un
issue normal.
