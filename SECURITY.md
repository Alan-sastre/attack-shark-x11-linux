# Security

**English** | [Español](SECURITY.es.md)

## Scope

This application sends Feature Reports to the Attack Shark X11 firmware.
Although the protocol is documented and operations are serialized, there is a
risk of leaving the device locked if malformed packets are sent.

## Safe practices

- Never send report `0x10`: it is related to bootloader mode.
- Do not read or write reports whose format is not documented.
- Respect the `0xA0` permission handshake and the minimum spacing between
  commands.
- If the mouse stops responding, unplug and reconnect the 2.4G receiver. On
  models with Bluetooth, briefly switch to Bluetooth and back to 2.4G.

## Reporting a vulnerability

Do not publish exploitable details in a public issue. Use the repository's
private GitHub security channel or contact the maintainers. Include:

- project version,
- operating system and browser,
- device PID,
- steps to reproduce,
- observed impact.

Pure hardware-compatibility questions can be handled in a normal issue.
