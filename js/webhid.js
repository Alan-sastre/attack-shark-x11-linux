/**
 * Attack Shark X11 - Driver WebHID Manager
 *
 * Cambios de seguridad importantes respecto a la versión anterior:
 *  - Solo se abre la interfaz de configuración (Usage Page 0x000B).
 *  - No se hace ninguna lectura ni escritura automática al conectar.
 *  - Todas las operaciones se serializan y se espacian >= 150 ms.
 *  - Las lecturas usan el handshake de permiso 0xA0 y comprueban su estado.
 *  - No se sondea la batería por Feature Report: llega por eventos (Report 0x03).
 */

class WebHidManager {
    constructor() {
        this.device = null;
        this.eventsDevice = null;
        this.isWired = false;
        this.listeners = {
            connected: [],
            disconnected: [],
            batteryUpdate: [],
            dpiCycle: [],
            commandAck: [],
            deviceEvent: [],
            error: []
        };

        // Cola de operaciones: evita enviar comandos solapados al firmware.
        this._queue = Promise.resolve();
        this._inputDevices = new Set();
        this._disconnectHandlerAttached = false;

        // Estado conocido para poder enviar reportes completos sin perder datos.
        this.preferences = {
            mode: 1,
            brightness: 5,
            speed: 3,
            r: 255,
            g: 0,
            b: 0,
            deepSleep: 0x0A,
            sleepTimerMin: 5,
            keyResponseMs: 4
        };
        this.sensor = {
            lod: 0,
            angleSnap: false,
            motionSync: true,
            rippleControl: false,
            dpiIndicator: 2
        };
        this.dpiConfig = {
            activeStage: 1,
            stages: [
                { dpi: 800, r: 255, g: 0, b: 0, enabled: true },
                { dpi: 1600, r: 0, g: 255, b: 0, enabled: true },
                { dpi: 2400, r: 0, g: 0, b: 255, enabled: true },
                { dpi: 3200, r: 255, g: 255, b: 0, enabled: true },
                { dpi: 5000, r: 0, g: 255, b: 255, enabled: true },
                { dpi: 10000, r: 255, g: 0, b: 255, enabled: true }
            ]
        };

        this._attachGlobalDisconnect();
    }

    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }

    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => {
                try { cb(data); } catch (e) { console.error(e); }
            });
        }
    }

    isSupported() {
        return Boolean(navigator && navigator.hid);
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _enqueue(task) {
        const run = this._queue.then(task, task);
        this._queue = run.catch(() => {});
        return run;
    }

    _attachGlobalDisconnect() {
        if (!this.isSupported() || this._disconnectHandlerAttached) return;
        this._disconnectHandlerAttached = true;
        navigator.hid.addEventListener("disconnect", (event) => {
            if (event.device === this.device) {
                this.handleDisconnect();
            } else if (event.device === this.eventsDevice) {
                this.eventsDevice = null;
            }
        });
    }

    /**
     * La interfaz de configuración es la que contiene la colección
     * Usage Page 0x000B. Nunca debemos abrir "la primera" que aparezca.
     */
    isConfigDevice(device) {
        return Boolean(
            device &&
            device.vendorId === Protocol.VID &&
            Array.isArray(device.collections) &&
            device.collections.some(c => c.usagePage === Protocol.USAGE_PAGE_CONFIG)
        );
    }

    isEventsDevice(device) {
        return Boolean(
            device &&
            device.vendorId === Protocol.VID &&
            Array.isArray(device.collections) &&
            device.collections.some(c => c.usagePage === Protocol.USAGE_PAGE_EVENTS)
        );
    }

    /**
     * Intenta reconectar un dispositivo ya autorizado previamente.
     * Solo considera interfaces de configuración válidas.
     */
    async checkExistingDevice() {
        if (!this.isSupported()) return null;
        try {
            const devices = await navigator.hid.getDevices();
            const configDevice = devices.find(dev => this.isConfigDevice(dev));
            if (configDevice) {
                await this.openDevice(configDevice);
                return this.device;
            }
        } catch (e) {
            console.warn("No se pudo autoconectar el dispositivo previo:", e);
        }
        return null;
    }

    /**
     * Abre el selector nativo de WebHID y valida que la interfaz elegida
     * sea realmente el canal de configuración.
     */
    async requestDevice() {
        if (!this.isSupported()) {
            throw new Error("Tu navegador no soporta WebHID. Usa Helium, Google Chrome, Chromium o Microsoft Edge.");
        }

        const filters = [
            { vendorId: Protocol.VID, productId: Protocol.PID_WIRELESS },
            { vendorId: Protocol.VID, productId: Protocol.PID_WIRED },
            { vendorId: Protocol.VID, productId: Protocol.PID_WIRED_ALT }
        ];

        let devices;
        try {
            devices = await navigator.hid.requestDevice({ filters });
        } catch (err) {
            throw new Error("Selección de dispositivo cancelada o denegada: " + err.message);
        }

        if (!devices || devices.length === 0) {
            throw new Error("No se seleccionó ningún dispositivo.");
        }

        let targetDev = devices.find(dev => this.isConfigDevice(dev));
        if (!targetDev) {
            // Si el usuario seleccionó otra interfaz, comprobar si ya existe
            // permiso para el canal de configuración. No abrimos una interfaz
            // arbitraria bajo ningún concepto.
            const granted = await navigator.hid.getDevices();
            targetDev = granted.find(dev => this.isConfigDevice(dev));
        }

        if (!targetDev) {
            throw new Error(
                "Se seleccionó una interfaz que no es el canal de configuración. " +
                "Vuelve a conectar y elige la entrada del Attack Shark X11 que permite configuración " +
                "(WebHID muestra una entrada por interfaz HID)."
            );
        }

        await this.openDevice(targetDev);
        return this.device;
    }

    /**
     * Abre y prepara el canal de configuración. No lee ni escribe nada.
     */
    async openDevice(device) {
        if (!device) return;
        if (!this.isConfigDevice(device)) {
            throw new Error("La interfaz seleccionada no es el canal de configuración (Usage Page 0x000B).");
        }

        if (this.device && this.device !== device) {
            await this.handleDisconnect();
        }

        if (!device.opened) {
            await device.open();
        }

        this.device = device;
        this.isWired = (device.productId === Protocol.PID_WIRED || device.productId === Protocol.PID_WIRED_ALT);

        console.log(
            `[WebHID] Canal de configuración conectado: ${device.productName || "Attack Shark X11"} ` +
            `(VID: 0x${device.vendorId.toString(16)}, PID: 0x${device.productId.toString(16)})`
        );

        this._attachInputListener(device);
        await this._attachEventsDevice();

        this.emit("connected", {
            device,
            productName: device.productName || "Attack Shark X11",
            isWired: this.isWired,
            productId: device.productId
        });

        // Deliberadamente NO se llama a readCurrentSettings() ni a ningún
        // sondeo de batería aquí. Todo se hace bajo demanda desde la UI.
    }

    _attachInputListener(device) {
        if (!device || this._inputDevices.has(device)) return;
        this._inputDevices.add(device);
        device.addEventListener("inputreport", (event) => this.handleInputReport(event));
    }

    async _attachEventsDevice() {
        if (!this.isSupported()) return;
        try {
            const devices = await navigator.hid.getDevices();
            const eventDev = devices.find(dev => this.isEventsDevice(dev));
            if (!eventDev) return;

            if (!eventDev.opened) {
                try {
                    await eventDev.open();
                } catch (e) {
                    // La interfaz de eventos puede no estar autorizada; no es
                    // imprescindible para configurar, solo para batería/ACK.
                    return;
                }
            }

            this.eventsDevice = eventDev;
            this._attachInputListener(eventDev);
            console.log("[WebHID] Interfaz de eventos conectada (batería/ACK).");
        } catch (e) {
            console.warn("[WebHID] No se pudo abrir la interfaz de eventos:", e);
        }
    }

    async handleDisconnect() {
        const configDevice = this.device;
        const eventDevice = this.eventsDevice;
        this.device = null;
        this.eventsDevice = null;

        if (configDevice) {
            try { await configDevice.close(); } catch (e) { /* ya cerrado */ }
        }
        if (eventDevice) {
            try { await eventDevice.close(); } catch (e) { /* ya cerrado */ }
        }

        if (configDevice) {
            console.warn("[WebHID] Ratón desconectado.");
            this.emit("disconnected");
        }
    }

    handleInputReport(event) {
        const view = event.data;
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        const parsed = Protocol.parseDeviceEvent(bytes);
        if (!parsed) return;

        if (parsed.type === "battery") {
            this.emit("batteryUpdate", {
                percentage: parsed.percentage,
                charging: parsed.charging
            });
        } else if (parsed.type === "dpiCycle") {
            this.emit("dpiCycle", parsed);
        } else if (parsed.type === "ack") {
            this.emit("commandAck", parsed);
            if (!parsed.success) {
                console.warn(`[WebHID] El firmware rechazó el reporte 0x${parsed.reportId.toString(16)}`);
            }
        }

        this.emit("deviceEvent", parsed);
    }

    _requireDevice() {
        if (!this.device || !this.device.opened) {
            throw new Error("El ratón Attack Shark X11 no está conectado.");
        }
        return this.device;
    }

    /**
     * Envía un Feature Report. `dataWithoutReportId` NO debe incluir el ID;
     * WebHID lo añade a partir del primer argumento.
     */
    async sendFeatureReport(reportId, dataWithoutReportId) {
        const device = this._requireDevice();
        return this._enqueue(async () => {
            try {
                await device.sendFeatureReport(reportId, dataWithoutReportId);
            } catch (err) {
                console.error(`Error enviando Feature Report 0x${reportId.toString(16)}:`, err);
                throw err;
            }
            // El firmware necesita tiempo para procesar cada comando.
            await this._delay(150);
        });
    }

    /**
     * Recibe un Feature Report. En Chromium el DataView incluye el Report ID
     * como primer byte, por lo que NO se debe anteponer otro.
     */
    async receiveFeatureReport(reportId) {
        const device = this._requireDevice();
        try {
            const dataView = await device.receiveFeatureReport(reportId);
            if (!dataView) return null;
            return new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
        } catch (err) {
            console.warn(`Error recibiendo Feature Report 0x${reportId.toString(16)}:`, err);
            return null;
        }
    }

    /**
     * Lectura segura:
     *  1. SET_REPORT 0xA0 pidiendo permiso de un solo uso.
     *  2. Esperar 250 ms.
     *  3. GET_REPORT 0xA0 y comprobar response[1] === 0x01.
     *  4. GET_REPORT del reporte objetivo.
     */
    async readReport(reportId, length, parameter = 0x01) {
        return this._enqueue(async () => {
            const device = this._requireDevice();
            const trigger = Protocol.buildQueryTrigger(reportId, length, parameter);

            try {
                await device.sendFeatureReport(Protocol.REPORTS.PERMISSION_COMMAND, trigger.slice(1));
            } catch (err) {
                throw new Error(`No se pudo solicitar permiso de lectura (0x${reportId.toString(16)}): ${err.message}`);
            }

            await this._delay(250);

            let auth = null;
            try {
                const view = await device.receiveFeatureReport(Protocol.REPORTS.PERMISSION_COMMAND);
                if (view) auth = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
            } catch (err) {
                throw new Error(`No se pudo comprobar el permiso de lectura (0x${reportId.toString(16)}): ${err.message}`);
            }

            if (!auth || auth.length < 2 || auth[1] !== 0x01) {
                const status = auth && auth.length > 1 ? auth[1] : "sin respuesta";
                throw new Error(`El firmware denegó la lectura del reporte 0x${reportId.toString(16)} (estado: ${status}).`);
            }

            let result = null;
            try {
                const view = await device.receiveFeatureReport(reportId);
                if (view) result = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
            } catch (err) {
                throw new Error(`No se pudo leer el reporte 0x${reportId.toString(16)}: ${err.message}`);
            }

            await this._delay(100);
            return result;
        });
    }

    // =========================================================================
    // Métodos de Alto Nivel de Configuración
    // =========================================================================

    async _sendPacket(packet) {
        const reportId = packet[0];
        const expected = Protocol.REPORT_LENGTHS[reportId];
        if (expected && packet.length !== expected) {
            throw new Error(`Paquete 0x${reportId.toString(16)} con longitud incorrecta: ${packet.length} (esperado ${expected}).`);
        }
        return this.sendFeatureReport(reportId, packet.slice(1));
    }

    async setPollingRate(rateHz) {
        await this._sendPacket(Protocol.buildPollingRatePacket(rateHz));
        console.log(`[WebHID] Polling Rate configurado a: ${rateHz} Hz`);
    }

    async setRgbLighting(config) {
        this.preferences = { ...this.preferences, ...config };
        await this._sendPacket(Protocol.buildRgbPacket(this.preferences));
        console.log(`[WebHID] Iluminación/preferencias aplicadas: modo ${this.preferences.mode}`);
    }

    async setDpiStages(dpiConfig) {
        const stages = Array.isArray(dpiConfig.stages) ? dpiConfig.stages : this.dpiConfig.stages;
        this.dpiConfig = {
            ...this.dpiConfig,
            ...dpiConfig,
            stages
        };

        await this._sendPacket(Protocol.buildDpiPacket({
            activeStage: this.dpiConfig.activeStage,
            stages: this.dpiConfig.stages,
            ...this.sensor
        }));
        console.log(`[WebHID] DPI configurado: etapa ${this.dpiConfig.activeStage + 1}`);
    }

    /**
     * LOD, angle snap, motion sync y ripple viven en el Report 0x04 (DPI),
     * no en el 0x08. Se envía el DPI actual junto con los flags del sensor.
     */
    async setSensorConfig(sensorConfig) {
        this.sensor = { ...this.sensor, ...sensorConfig };

        await this._sendPacket(Protocol.buildDpiPacket({
            activeStage: this.dpiConfig.activeStage,
            stages: this.dpiConfig.stages,
            ...this.sensor
        }));

        // El temporizador de reposo y la respuesta de teclas viven en las
        // preferencias (Report 0x05).
        if (sensorConfig.sleepTimerMin !== undefined || sensorConfig.keyResponseMs !== undefined) {
            if (sensorConfig.sleepTimerMin !== undefined) {
                this.preferences.sleepTimerMin = sensorConfig.sleepTimerMin;
            }
            if (sensorConfig.keyResponseMs !== undefined) {
                this.preferences.keyResponseMs = sensorConfig.keyResponseMs;
            }
            await this._sendPacket(Protocol.buildRgbPacket(this.preferences));
        }

        console.log("[WebHID] Parámetros del sensor aplicados.");
    }

    async setButtonMapping(actions) {
        await this._sendPacket(Protocol.buildButtonMappingPacket(actions));
        console.log("[WebHID] Mapeo de botones actualizado.");
    }

    /**
     * Lee la configuración actual bajo demanda. No se llama automáticamente
     * al conectar. Cada lectura usa su propio permiso y se serializa.
     */
    async readCurrentSettings() {
        if (!this.device || !this.device.opened) return null;

        const settings = {
            pollingRate: null,
            rgb: null,
            dpi: null,
            buttons: null,
            errors: []
        };

        const read = async (reportId, length, parser) => {
            try {
                const data = await this.readReport(reportId, length);
                if (!data) throw new Error("respuesta vacía");
                return parser(data);
            } catch (e) {
                settings.errors.push(e.message);
                return null;
            }
        };

        settings.pollingRate = await read(Protocol.REPORTS.POLLING, Protocol.READ_LENGTHS[0x06], Protocol.parsePollingRatePacket);
        settings.rgb = await read(Protocol.REPORTS.LIGHTING, Protocol.READ_LENGTHS[0x05], Protocol.parseRgbPacket);
        settings.dpi = await read(Protocol.REPORTS.DPI, Protocol.READ_LENGTHS[0x04], Protocol.parseDpiPacket);
        settings.buttons = await read(Protocol.REPORTS.BUTTON_MAPPING, Protocol.READ_LENGTHS[0x08], Protocol.parseButtonMappingPacket);

        if (settings.rgb) {
            this.preferences = { ...this.preferences, ...settings.rgb };
        }
        if (settings.dpi) {
            this.dpiConfig = {
                activeStage: settings.dpi.activeStage,
                stages: settings.dpi.stages
            };
            this.sensor = {
                lod: settings.dpi.lod,
                angleSnap: settings.dpi.angleSnap,
                motionSync: settings.dpi.motionSync,
                rippleControl: settings.dpi.rippleControl,
                dpiIndicator: settings.dpi.dpiIndicator
            };
        }

        return settings;
    }
}

window.WebHidManager = WebHidManager;
