# Dossier de Ingeniería Inversa: Attack Shark X11 en Linux

Este documento describe el protocolo HID del Attack Shark X11 (VID `0x1D57`,
PIDs `0xFA60`, `0xFA61`, `0x2124`) verificado contra el descriptor real del
receptor y la documentación de la comunidad. El objetivo es que cualquier
paquete enviado al ratón sea correcto, esté bien serializado y no deje el
dispositivo sin responder.

---

## 1. Interfaces HID del receptor

El receptor 2.4G expone cuatro interfaces. La configuración se realiza
**únicamente** en la interfaz cuyo descriptor contiene `Usage Page 0x000B`:

| Interfaz | Uso | Nodo típico |
| :--- | :--- | :--- |
| 0 | Teclado | `hidraw3` (protegido por el kernel) |
| 1 | Ratón estándar: 5 botones HID | `hidraw4` |
| 2 | System Control + Consumer + vendor (`0x0B`) | `hidraw5` ← configuración |
| 3 | Teclado / multimedia | `hidraw6` |

La interfaz de eventos (`Usage Page 0x000A`) es independiente y se usa para
notificaciones asíncronas: batería, ACK de comandos y cambios de perfil/DPI.

En WebHID se debe validar la colección:

```js
device.collections.some(c => c.usagePage === 0x000B)
```

Nunca se debe abrir "el primer dispositivo" que coincida con el VID/PID ni una
interfaz distinta. Hacerlo puede enviar comandos al canal equivocado.

### Base de carga

La base de carga RGB del X11 **no es un dispositivo HID de configuración** y no
comparte el reporte `0x05` del ratón. En el hardware verificado no enumera como
un USB adicional: es una base de alimentación con un controlador LED propio y un
botón táctil. Una pulsación corta cambia el efecto/color y una pulsación larga
apaga la iluminación. El software oficial tampoco permite fijar un color
arbitrario en la base; esta aplicación controla únicamente el RGB del ratón.

---

## 2. Report IDs y longitudes

| Reporte | ID | Longitud total | Uso |
| :--- | :--- | :--- | :--- |
| DPI | `0x04` | 56 (`0x38`) | Etapas, LOD, Motion Sync, Angle Snap, Ripple, indicador |
| Iluminación / preferencias | `0x05` | 15 (`0x0F`) | Modo, color, brillo, velocidad, reposo |
| Polling Rate | `0x06` | 9 (`0x09`) | 125 / 250 / 500 / 1000 Hz |
| Wake-up | `0x07` | 7 | Modo de despertar |
| Mapeo de botones | `0x08` | 59 (`0x3B`) | 18 slots de 3 bytes |
| Macro | `0x09` | 64 (`0x40`) | Macros |
| Perfil | `0x0A` | variable (`0x80` al leer) | Perfiles |
| Versión del dispositivo | `0x0B` | 8 | **No es la batería** |
| Ajustes de perfil | `0x0C` | 10 | Ajustes de perfil |
| Permiso de lectura | `0xA0` | 8 | Handshake de un solo uso |
| Eventos | `0x03` | variable | Interfaz de eventos |

> **Peligro:** no leer ni escribir el reporte `0x10`. Está asociado al modo
> bootloader y no se debe usar desde la aplicación.

---

## 3. Checksum

Los reportes `0x04`, `0x05` y `0x08` terminan con una suma de 16 bits en
big-endian. El rango sumado **no incluye** el Report ID ni el byte de longitud:

```python
def checksum(buf, start, end):
    total = sum(buf[start:end]) & 0xFFFF
    return (total >> 8) & 0xFF, total & 0xFF
```

- DPI: suma bytes `3..49`, checksum en `50..51`.
- Iluminación: suma bytes `3..10`, checksum en `11..12`.
- Botones: suma bytes `3..56`, checksum en `57..58`.

El **Polling Rate no usa checksum de 16 bits**: el byte `4` es simplemente
`código ^ 0xFF`.

---

## 4. Handshake de lectura

Cada lectura consume un permiso de un solo uso. Se debe serializar y esperar:

1. `SET_REPORT 0xA0` con 8 bytes:
   `[0xA0, reportId, longitudEsperada, 0x00, 0x01, 0x00, 0x00, 0x00]`.
2. Esperar **250 ms**.
3. `GET_REPORT 0xA0` (8 bytes) y comprobar que `respuesta[1] === 0x01`.
4. `GET_REPORT` del reporte objetivo una sola vez.
5. Esperar al menos 100 ms antes de la siguiente operación.

Una longitud o un parámetro incorrectos hacen que el firmware rechace la
lectura. No se debe pedir permiso para varios reportes a la vez ni leer en
bucle.

---

## 5. Estructura de los reportes

### 5.1 Polling Rate — `0x06`, 9 bytes

| Offset | Valor |
| :--- | :--- |
| `0x00` | `0x06` |
| `0x01` | `0x09` |
| `0x02` | `0x01` (perfil) |
| `0x03` | `0x08`=125, `0x04`=250, `0x02`=500, `0x01`=1000 |
| `0x04` | `código ^ 0xFF` |
| `0x05..0x08` | `0x00` |

### 5.2 Iluminación y preferencias — `0x05`, 15 bytes

| Offset | Valor |
| :--- | :--- |
| `0x00` | `0x05` |
| `0x01` | `0x0F` |
| `0x02` | `0x01` (perfil) |
| `0x03` | `(modo << 4)`; modos `0..6` |
| `0x04` | `(deepSleep & 0xF0) \| (velocidad & 0x0F)` |
| `0x05` | `((deepSleep & 0x0F) << 4) \| (brillo & 0x0F)` |
| `0x06..0x08` | R, G, B |
| `0x09` | minutos de reposo × 2 (0.5–30) |
| `0x0A` | `keyResponseMs / 2` (4–50) |
| `0x0B..0x0C` | checksum big-endian de `3..10` |
| `0x0D..0x0E` | padding |

Modos reales del X11: `0` apagado, `1` estático, `2` respiración, `3` neón,
`4` respiración multicolor, `5` DPI fijo, `6` DPI respirando. Los modos `7..11`
del software original no tienen efecto en este modelo.

Velocidad LED `1..5`, brillo `1..8`.

### 5.3 DPI — `0x04`, 56 bytes

| Offset | Valor |
| :--- | :--- |
| `0x00` | `0x04` |
| `0x01` | `0x38` |
| `0x02` | `0x01` (perfil) |
| `0x03` | `(LOD << 4) \| angleSnap`; LOD `0`=1 mm, `1`=2 mm, `2`=0.7 mm |
| `0x04` | `(motionSync ? 0x10 : 0) \| rippleControl` |
| `0x05` | bitmask de etapas activas (por defecto `0x3F`) |
| `0x06` | bitmask de etapas con escala doble |
| `0x07` | bitmask de etapas con escala triple |
| `0x08..0x0F` | byte bajo del DPI de las etapas 1..8 |
| `0x10..0x17` | byte alto / modo de las etapas 1..8 |
| `0x18` | etapa activa **1-based** |
| `0x19..0x30` | 8 colores RGB (3 bytes por etapa) |
| `0x31` | indicador DPI: `1` parpadeo, `2` fijo, `3` apagado |
| `0x32..0x33` | checksum big-endian de `3..49` |
| `0x34..0x37` | padding |

La codificación **no es lineal**. El sensor PAW3311 usa una tabla de 220
entradas:

- Índices `0..199`: DPI `50..10000` en pasos de 50, byte alto `0`.
- Índices `200..219`: DPI `10100..12000` en pasos de 100, byte alto `1`.
- DPI `> 12000` y `< 24000`: se divide entre 2 y se marca la etapa como
  "double".
- DPI `24100..25000`: se divide entre 3 y se marca como "triple".
- Para decodificar valores altos se debe usar la última aparición del byte en
  la tabla (`lastIndexOf`), porque la tabla contiene valores repetidos entre
  ambos tramos.

### 5.4 Mapeo de botones — `0x08`, 59 bytes

| Offset | Valor |
| :--- | :--- |
| `0x00` | `0x08` |
| `0x01` | `0x3B` |
| `0x02` | `0x01` (perfil) |
| `0x03..0x38` | 18 slots × 3 bytes: `[acción, modificadores, usageId]` |
| `0x39..0x3A` | checksum big-endian de `3..56` |

Offset del slot `n` (1-based): `3 + (n - 1) * 3`.

Valores por defecto de escritura:

| Slot | Acción | Uso |
| :--- | :--- | :--- |
| 1 | `0x02` | Clic izquierdo |
| 2 | `0x03` | Clic derecho |
| 3 | `0x04` | Clic central |
| 4 | `0x01` | Desactivado |
| 5 | `0x01` | Desactivado (protegido) |
| 6 | `0x0D` | Ciclo de DPI |
| 7 | `0x06` | Adelante |
| 8 | `0x05` | Atrás |
| 9..16 | `0x01` | Desactivado |
| 17 | `0x09` | Rueda arriba |
| 18 | `0x0A` | Rueda abajo |

Al leer, el firmware reordena algunos slots (por ejemplo, el slot 7 de lectura
puede mostrar `0x3C`, la tecla de modo). La aplicación usa un mapa de lectura
distinto del de escritura.

Acciones del firmware (`FirmwareAction`): `0x01` desactivado, `0x02` clic
izquierdo, `0x03` clic derecho, `0x04` clic central, `0x05` atrás, `0x06`
adelante, `0x07` doble clic, `0x08` fuego, `0x09` rueda arriba, `0x0A` rueda
abajo, `0x0D` ciclo DPI, `0x0E` DPI+, `0x0F` DPI-, `0x10` sniper, `0x11`
teclado, `0x12` macro, `0x13` abrir programa, `0x14` menú inicio, `0x15..0x1C`
multimedia, `0x1D..0x26` sistema/navegador, `0x28..0x36` perfiles y ciclos.
Modificadores: Ctrl `1`, Shift `2`, Alt `4`, Win `8`.

### 5.5 Eventos asíncronos — Report `0x03`

En WebHID, `inputreport.data` **no incluye** el Report ID. El formato es:

```
[0x55, código, param1, param2]
```

| Código | Significado |
| :--- | :--- |
| `0x40` / `0x41` | Batería: `param1` estado, `param2` porcentaje |
| `0x50` | ACK: `param1` `0`=éxito, `1`=fallo; `param2`=Report ID |
| `0x10` | Cambio de etapa DPI: `param1` etapa 1-based |
| `0x80` | Cambio de perfil |

La batería **no se lee con el reporte `0x0B`**. El `0x0B` es la versión del
dispositivo. Si no se concede permiso a la interfaz de eventos, la aplicación
simplemente no muestra la batería; no debe intentar sondearla por Feature
Report.

---

## 6. Buenas prácticas y recuperación

- Serializar todas las operaciones y dejar al menos **150 ms** entre reportes.
- No enviar paquetes desconocidos o con longitudes incorrectas: algunos
  ajustes se persisten en el firmware.
- No leer en bucle ni pedir varios permisos `0xA0` a la vez.
- Tras una escritura, el ACK (`0x50`) llega por la interfaz de eventos. Si no
  está disponible, no bloquear la aplicación esperándolo indefinidamente.
- Si el ratón deja de responder: desconectar y reconectar el receptor 2.4G.
  En modelos con Bluetooth, cambiar brevemente a Bluetooth y volver a 2.4G
  también reinicia la comunicación. No hay recuperación de firmware por
  software.

---

## 7. Referencias

- `HarukaYamamoto0/attack-shark-x11-driver` (MIT): documentación del protocolo,
  builders de DPI, botones, polling e iluminación.
- `iago-fragnan/attack-shark-x11-linux` (GPL-3.0): análisis complementario y
  uso de la interfaz de eventos.
- Descriptor HID real del receptor `1d57:fa60` en
  `/sys/class/hidraw/hidraw5/device/report_descriptor`.
