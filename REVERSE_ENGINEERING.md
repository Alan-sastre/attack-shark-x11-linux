# Reverse Engineering Dossier: Attack Shark X11 on Linux

**English** | [Español](REVERSE_ENGINEERING.es.md)

This document describes the HID protocol of the Attack Shark X11 (VID `0x1D57`,
PIDs `0xFA60`, `0xFA61`, `0x2124`) as verified against the receiver's real
descriptor and community documentation. The goal is for every packet sent to
the mouse to be correct, well serialized, and unable to leave the device
unresponsive.

---

## 1. Receiver HID interfaces

The 2.4G receiver exposes four interfaces. Configuration is performed
**only** on the interface whose descriptor contains `Usage Page 0x000B`:

| Interface | Purpose | Typical node |
| :--- | :--- | :--- |
| 0 | Keyboard | `hidraw3` (kernel-protected) |
| 1 | Standard mouse: 5 HID buttons | `hidraw4` |
| 2 | System Control + Consumer + vendor (`0x0B`) | `hidraw5` ← configuration |
| 3 | Keyboard / media | `hidraw6` |

The events interface (`Usage Page 0x000A`) is separate and is used for
asynchronous notifications: battery, command ACKs, and profile/DPI changes.

In WebHID, validate the collection:

```js
device.collections.some(c => c.usagePage === 0x000B)
```

Never open "the first device" matching the VID/PID, and never open a different
interface. Doing so can send commands to the wrong channel.

### Charging dock

The X11 RGB charging dock **is not a configurable HID device** and does not
share the mouse's report `0x05`. On the verified hardware it does not enumerate
as an additional USB device: it is a power dock with its own LED controller and
a touch button. A short press changes the effect/color, and a long press turns
the lighting off. The official software also cannot set an arbitrary fixed color
on the dock; this application controls only the mouse RGB.

---

## 2. Report IDs and lengths

| Report | ID | Total length | Purpose |
| :--- | :--- | :--- | :--- |
| DPI | `0x04` | 56 (`0x38`) | Stages, LOD, Motion Sync, Angle Snap, Ripple, indicator |
| Lighting / preferences | `0x05` | 15 (`0x0F`) | Mode, color, brightness, speed, sleep |
| Polling rate | `0x06` | 9 (`0x09`) | 125 / 250 / 500 / 1000 Hz |
| Wake-up | `0x07` | 7 | Wake-up mode |
| Button mapping | `0x08` | 59 (`0x3B`) | 18 slots of 3 bytes |
| Macro | `0x09` | 64 (`0x40`) | Macros |
| Profile | `0x0A` | variable (`0x80` when reading) | Profiles |
| Device version | `0x0B` | 8 | **Not the battery** |
| Profile settings | `0x0C` | 10 | Profile settings |
| Read permission | `0xA0` | 8 | Single-use handshake |
| Events | `0x03` | variable | Events interface |

> **Danger:** do not read or write report `0x10`. It is associated with
> bootloader mode and must not be used by the application.

---

## 3. Checksum

Reports `0x04`, `0x05` and `0x08` end with a 16-bit big-endian sum. The summed
range **does not include** the Report ID or the length byte:

```python
def checksum(buf, start, end):
    total = sum(buf[start:end]) & 0xFFFF
    return (total >> 8) & 0xFF, total & 0xFF
```

- DPI: sum bytes `3..49`, checksum at `50..51`.
- Lighting: sum bytes `3..10`, checksum at `11..12`.
- Buttons: sum bytes `3..56`, checksum at `57..58`.

The **polling rate does not use a 16-bit checksum**: byte `4` is simply
`code ^ 0xFF`.

---

## 4. Read handshake

Every read consumes a single-use permission. It must be serialized and waited
for:

1. `SET_REPORT 0xA0` with 8 bytes:
   `[0xA0, reportId, expectedLength, 0x00, 0x01, 0x00, 0x00, 0x00]`.
2. Wait **250 ms**.
3. `GET_REPORT 0xA0` (8 bytes) and check that `response[1] === 0x01`.
4. `GET_REPORT` the target report once.
5. Wait at least 100 ms before the next operation.

An incorrect length or parameter causes the firmware to reject the read. Do not
request permission for several reports at once, and do not read in a loop.

---

## 5. Report structures

### 5.1 Polling rate — `0x06`, 9 bytes

| Offset | Value |
| :--- | :--- |
| `0x00` | `0x06` |
| `0x01` | `0x09` |
| `0x02` | `0x01` (profile) |
| `0x03` | `0x08`=125, `0x04`=250, `0x02`=500, `0x01`=1000 |
| `0x04` | `code ^ 0xFF` |
| `0x05..0x08` | `0x00` |

### 5.2 Lighting and preferences — `0x05`, 15 bytes

| Offset | Value |
| :--- | :--- |
| `0x00` | `0x05` |
| `0x01` | `0x0F` |
| `0x02` | `0x01` (profile) |
| `0x03` | `(mode << 4)`; modes `0..6` |
| `0x04` | `(deepSleep & 0xF0) \| (speed & 0x0F)` |
| `0x05` | `((deepSleep & 0x0F) << 4) \| (brightness & 0x0F)` |
| `0x06..0x08` | R, G, B |
| `0x09` | sleep minutes × 2 (0.5–30) |
| `0x0A` | `keyResponseMs / 2` (4–50) |
| `0x0B..0x0C` | big-endian checksum of `3..10` |
| `0x0D..0x0E` | padding |

Real X11 modes: `0` off, `1` static, `2` breathing, `3` neon, `4` color
breathing, `5` static DPI, `6` breathing DPI. Modes `7..11` from the original
software have no effect on this model.

LED speed `1..5`, brightness `1..8`.

### 5.3 DPI — `0x04`, 56 bytes

| Offset | Value |
| :--- | :--- |
| `0x00` | `0x04` |
| `0x01` | `0x38` |
| `0x02` | `0x01` (profile) |
| `0x03` | `(LOD << 4) \| angleSnap`; LOD `0`=1 mm, `1`=2 mm, `2`=0.7 mm |
| `0x04` | `(motionSync ? 0x10 : 0) \| rippleControl` |
| `0x05` | bitmask of active stages (default `0x3F`) |
| `0x06` | bitmask of stages with double scale |
| `0x07` | bitmask of stages with triple scale |
| `0x08..0x0F` | low DPI byte for stages 1..8 |
| `0x10..0x17` | high/mode byte for stages 1..8 |
| `0x18` | active stage, **1-based** |
| `0x19..0x30` | 8 RGB colors (3 bytes per stage) |
| `0x31` | DPI indicator: `1` blinking, `2` static, `3` off |
| `0x32..0x33` | big-endian checksum of `3..49` |
| `0x34..0x37` | padding |

The encoding **is not linear**. The PAW3311 sensor uses a 220-entry table:

- Indices `0..199`: DPI `50..10000` in steps of 50, high byte `0`.
- Indices `200..219`: DPI `10100..12000` in steps of 100, high byte `1`.
- DPI `> 12000` and `< 24000`: divide by 2 and mark the stage as "double".
- DPI `24100..25000`: divide by 3 and mark it as "triple".
- To decode high values, use the last occurrence of the byte in the table
  (`lastIndexOf`), because the table contains repeated values across both
  ranges.

### 5.4 Button mapping — `0x08`, 59 bytes

| Offset | Value |
| :--- | :--- |
| `0x00` | `0x08` |
| `0x01` | `0x3B` |
| `0x02` | `0x01` (profile) |
| `0x03..0x38` | 18 slots × 3 bytes: `[action, modifiers, usageId]` |
| `0x39..0x3A` | big-endian checksum of `3..56` |

Offset of slot `n` (1-based): `3 + (n - 1) * 3`.

Default write values:

| Slot | Action | Purpose |
| :--- | :--- | :--- |
| 1 | `0x02` | Left click |
| 2 | `0x03` | Right click |
| 3 | `0x04` | Middle click |
| 4 | `0x01` | Disabled |
| 5 | `0x01` | Disabled (protected) |
| 6 | `0x0D` | DPI cycle |
| 7 | `0x06` | Forward |
| 8 | `0x05` | Back |
| 9..16 | `0x01` | Disabled |
| 17 | `0x09` | Scroll up |
| 18 | `0x0A` | Scroll down |

When reading, the firmware reorders some slots (for example, read slot 7 may
show `0x3C`, the mode key). The application uses a different read map from the
write map.

Firmware actions (`FirmwareAction`): `0x01` disabled, `0x02` left click,
`0x03` right click, `0x04` middle click, `0x05` back, `0x06` forward,
`0x07` double click, `0x08` fire, `0x09` scroll up, `0x0A` scroll down,
`0x0D` DPI cycle, `0x0E` DPI+, `0x0F` DPI-, `0x10` sniper, `0x11` keyboard,
`0x12` macro, `0x13` launch program, `0x14` start menu, `0x15..0x1C` media,
`0x1D..0x26` system/browser, `0x28..0x36` profiles and cycles.
Modifiers: Ctrl `1`, Shift `2`, Alt `4`, Win `8`.

### 5.5 Asynchronous events — report `0x03`

In WebHID, `inputreport.data` **does not include** the Report ID. The format is:

```
[0x55, code, param1, param2]
```

| Code | Meaning |
| :--- | :--- |
| `0x40` / `0x41` | Battery: `param1` status, `param2` percentage |
| `0x50` | ACK: `param1` `0`=success, `1`=failure; `param2`=Report ID |
| `0x10` | DPI stage change: `param1` 1-based stage |
| `0x80` | Profile change |

The battery **is not read through report `0x0B`**. `0x0B` is the device
version. If permission for the events interface is not granted, the application
simply does not show the battery; it must not try to poll it through a Feature
Report.

---

## 6. Best practices and recovery

- Serialize all operations and leave at least **150 ms** between reports.
- Do not send unknown packets or packets with incorrect lengths: some settings
  are persisted in firmware.
- Do not read in a loop or request several `0xA0` permissions at once.
- After a write, the ACK (`0x50`) arrives on the events interface. If it is not
  available, do not block the application waiting for it indefinitely.
- If the mouse stops responding: unplug and reconnect the 2.4G receiver. On
  models with Bluetooth, briefly switching to Bluetooth and back to 2.4G also
  resets communication. There is no software firmware recovery.

---

## 7. References

- `HarukaYamamoto0/attack-shark-x11-driver` (MIT): protocol documentation,
  DPI, button, polling and lighting builders.
- `iago-fragnan/attack-shark-x11-linux` (GPL-3.0): complementary analysis and
  use of the events interface.
- Real HID descriptor of the `1d57:fa60` receiver at
  `/sys/class/hidraw/hidraw5/device/report_descriptor`.
