# Contributing

**English** | [Español](CONTRIBUTING.es.md)

Thank you for helping improve Attack Shark X11 support on Linux.

## Before you start

- This project talks directly to the mouse firmware. An incorrect packet can
  leave the device unresponsive until it is reconnected.
- Never send report `0x10` (bootloader mode).
- If you change the protocol, update
  [`REVERSE_ENGINEERING.md`](REVERSE_ENGINEERING.md) and the manual tests
  described there as well.

## Development environment

```bash
git clone https://github.com/Alan-sastre/attack-shark-x11-linux.git
cd attack-shark-x11-linux
sudo ./setup_udev.sh
./run.sh
```

Requirements:

- Linux with `udev`
- Python 3.10 or newer
- A Chromium-based browser with WebHID support (Helium, Chrome, Chromium, Brave or Edge)

## Checks before a pull request

```bash
node --check js/protocol.js
node --check js/webhid.js
node --check js/app.js
python3 -m py_compile shark_ctl.py server.py
bash -n run.sh setup_udev.sh install.sh
```

If you have tested with real hardware, include the model, PID and which
commands you ran. Do not attach logs containing personal data.

## Commit style

[Conventional Commits](https://www.conventionalcommits.org/en/) are recommended:

- `feat:` new functionality
- `fix:` bug fix
- `docs:` documentation
- `style:` formatting or styles
- `refactor:` internal changes without behavior changes
- `test:` tests
- `build:` scripts, dependencies or packaging
- `ci:` continuous integration
- `chore:` maintenance

Example:

```text
fix(webhid): serialize reads and wait for the 0xA0 permission
```

## License

By contributing, you agree that your contribution will be published under the
project's MIT license.
