/**
 * Attack Shark X11 - Protocolo HID de Comunicación y Configuración
 *
 * Implementación basada en el protocolo documentado por la comunidad
 * (HarukaYamamoto0/attack-shark-x11-driver, MIT) y verificado contra el
 * descriptor HID real del receptor 1d57:fa60.
 *
 * Reglas importantes:
 *  - El canal de configuración es la interfaz con Usage Page 0x000B.
 *  - Las lecturas usan un permiso de un solo uso (SET_REPORT 0xA0 y luego
 *    GET_REPORT 0xA0 para comprobar el estado antes de leer el reporte).
 *  - Los reportes de escritura deben enviarse con pausas (>= 150 ms).
 *  - Nunca se debe escribir el reporte 0x10 (modo bootloader).
 */

const Protocol = {
    // Identificadores de Hardware USB
    VID: 0x1D57,
    PID_WIRELESS: 0xFA60, // Receptor 2.4G USB
    PID_WIRED: 0xFA61,    // Conexión por cable USB
    PID_WIRED_ALT: 0x2124,// Variante cableada alternativa

    // Interfaz de configuración (top-level collection Usage Page 0x000B)
    USAGE_PAGE_CONFIG: 0x000B,
    USAGE_PAGE_EVENTS: 0x000A,

    // Report IDs
    REPORTS: {
        EVENT: 0x03,           // Notificaciones asíncronas (interfaz Events)
        DPI: 0x04,             // 56 bytes (0x38)
        LIGHTING: 0x05,        // 15 bytes (0x0F)
        RGB: 0x05,             // alias
        POLLING: 0x06,         // 9 bytes  (0x09)
        WAKE_UP: 0x07,         // 7 bytes  (0x07)
        BUTTON_MAPPING: 0x08,  // 59 bytes (0x3B)
        SENSOR: 0x08,          // alias histórico (NO es sensor: es mapeo de botones)
        MACRO: 0x09,           // 64 bytes (0x40)
        PROFILE: 0x0A,         // 7 bytes  (0x07)
        DEVICE_VERSION: 0x0B,  // 8 bytes  (0x08)
        DEVICE_STATUS: 0x0B,   // alias histórico (NO es batería: es versión)
        PROFILE_SETTING: 0x0C, // 10 bytes (0x0A)
        PERMISSION_COMMAND: 0xA0,
        QUERY_TRIGGER: 0xA0    // alias
    },

    // Longitud total del reporte, incluyendo el byte de Report ID.
    REPORT_LENGTHS: {
        0x04: 0x38,
        0x05: 0x0F,
        0x06: 0x09,
        0x07: 0x07,
        0x08: 0x3B,
        0x09: 0x40,
        0x0A: 0x07,
        0x0B: 0x08,
        0x0C: 0x0A,
        0xA0: 0x08
    },

    // Longitud solicitada al firmware para lecturas (GET_REPORT).
    READ_LENGTHS: {
        0x04: 0x38,
        0x05: 0x0F,
        0x06: 0x09,
        0x08: 0x3B,
        0x09: 0x83,
        0x0B: 0x08,
        0x0A: 0x80,
        0x0C: 0x0A
    },

    // Tasas de sondeo (Polling Rates)
    POLLING_RATES: {
        125:  { code: 0x08, inv: 0xF7, label: "125 Hz (8 ms)" },
        250:  { code: 0x04, inv: 0xFB, label: "250 Hz (4 ms)" },
        500:  { code: 0x02, inv: 0xFD, label: "500 Hz (2 ms)" },
        1000: { code: 0x01, inv: 0xFE, label: "1000 Hz (1 ms)" }
    },

    // Modos de iluminación soportados por el X11 (nibble alto del byte 3).
    // Los modos 7..11 existen en el software original pero no tienen efecto
    // en este modelo; no los mostramos para evitar configuraciones engañosas.
    RGB_MODES: [
        { id: 0, name: "Apagado", en: "LED Off" },
        { id: 1, name: "Estático", en: "Static Color" },
        { id: 2, name: "Respiración", en: "Breathing" },
        { id: 3, name: "Neón", en: "Neon Wave" },
        { id: 4, name: "Respiración Multicolor", en: "Color Cycle Breathing" },
        { id: 5, name: "Color Fijo de DPI", en: "Static DPI" },
        { id: 6, name: "Respiración DPI", en: "Breathing DPI" }
    ],

    // FirmwareAction: identificadores reales de las funciones del firmware.
    BUTTON_ACTIONS: [
        { id: 0x01, name: "Desactivado", group: "Otros" },
        { id: 0x02, name: "Clic Izquierdo", group: "Ratón" },
        { id: 0x03, name: "Clic Derecho", group: "Ratón" },
        { id: 0x04, name: "Clic Central (Rueda)", group: "Ratón" },
        { id: 0x05, name: "Retroceder (Atrás)", group: "Ratón" },
        { id: 0x06, name: "Avanzar (Adelante)", group: "Ratón" },
        { id: 0x07, name: "Doble Clic", group: "Ratón" },
        { id: 0x08, name: "Fuego (Fire)", group: "Gaming" },
        { id: 0x09, name: "Rueda Arriba", group: "Ratón" },
        { id: 0x0A, name: "Rueda Abajo", group: "Ratón" },
        { id: 0x0D, name: "Ciclo de DPI", group: "DPI" },
        { id: 0x0E, name: "DPI +", group: "DPI" },
        { id: 0x0F, name: "DPI -", group: "DPI" },
        { id: 0x10, name: "Sniper (DPI temporal)", group: "DPI" },
        { id: 0x11, name: "Tecla de teclado", group: "Teclado" },
        { id: 0x12, name: "Macro personalizada", group: "Macros" },
        { id: 0x13, name: "Abrir programa", group: "Sistema" },
        { id: 0x14, name: "Menú Inicio", group: "Sistema" },
        { id: 0x15, name: "Reproductor multimedia", group: "Multimedia" },
        { id: 0x16, name: "Pista anterior", group: "Multimedia" },
        { id: 0x17, name: "Pista siguiente", group: "Multimedia" },
        { id: 0x18, name: "Play / Pausa", group: "Multimedia" },
        { id: 0x19, name: "Detener", group: "Multimedia" },
        { id: 0x1A, name: "Silenciar", group: "Multimedia" },
        { id: 0x1B, name: "Subir volumen", group: "Multimedia" },
        { id: 0x1C, name: "Bajar volumen", group: "Multimedia" },
        { id: 0x1D, name: "Calculadora", group: "Sistema" },
        { id: 0x1E, name: "Correo", group: "Sistema" },
        { id: 0x1F, name: "Favoritos del navegador", group: "Navegador" },
        { id: 0x20, name: "Navegador: Adelante", group: "Navegador" },
        { id: 0x21, name: "Navegador: Atrás", group: "Navegador" },
        { id: 0x22, name: "Navegador: Detener", group: "Navegador" },
        { id: 0x23, name: "Mi PC", group: "Sistema" },
        { id: 0x24, name: "Navegador: Actualizar", group: "Navegador" },
        { id: 0x25, name: "Navegador: Inicio", group: "Navegador" },
        { id: 0x26, name: "Navegador: Buscar", group: "Navegador" },
        { id: 0x28, name: "Ciclo de tasa de sondeo", group: "Sistema" },
        { id: 0x29, name: "Ciclo de iluminación", group: "Sistema" },
        { id: 0x30, name: "Encender / apagar LED", group: "Sistema" },
        { id: 0x32, name: "Macro de clic izquierdo", group: "Macros" },
        { id: 0x33, name: "Salir de macro de clic", group: "Macros" },
        { id: 0x34, name: "Ciclo de perfil", group: "Perfiles" },
        { id: 0x35, name: "Perfil +", group: "Perfiles" },
        { id: 0x36, name: "Perfil -", group: "Perfiles" }
    ],

    // Botones físicos. El X11 expone 5 botones HID estándar; el botón
    // superior de DPI es un control de firmware independiente (slot 6),
    // no un sexto botón HID. Por eso se marca con advanced: true.
    MOUSE_BUTTONS: [
        { index: 0, label: "Clic izquierdo", short: "Izquierdo", slot: 1, hidButton: 1, defaultAction: 0x02 },
        { index: 1, label: "Clic derecho", short: "Derecho", slot: 2, hidButton: 2, defaultAction: 0x03 },
        { index: 2, label: "Rueda / clic central", short: "Rueda", slot: 3, hidButton: 3, defaultAction: 0x04 },
        { index: 3, label: "Lateral adelante", short: "Adelante", slot: 7, hidButton: 4, defaultAction: 0x06 },
        { index: 4, label: "Lateral atrás", short: "Atrás", slot: 8, hidButton: 5, defaultAction: 0x05 },
        {
            index: 5,
            label: "Botón DPI (superior)",
            short: "DPI",
            slot: 6,
            hidButton: null,
            defaultAction: 0x0D,
            advanced: true,
            note: "Control de firmware, no es un botón HID estándar"
        }
    ],

    /**
     * Suma de verificación de 16 bits big-endian usada por el firmware.
     * Suma los bytes [start, end) y devuelve [high, low].
     */
    calculateChecksum(buffer, start = 0, end = buffer.length - 2) {
        let sum = 0;
        for (let i = start; i < end; i++) {
            sum = (sum + buffer[i]) & 0xFFFF;
        }
        return [(sum >> 8) & 0xFF, sum & 0xFF];
    },

    /**
     * Construye el paquete de permiso/consulta de lectura.
     * [0xA0, reportId, reportLen, 0x00, param, 0x00, 0x00, 0x00]
     * El permiso es de un solo uso: hay que solicitarlo antes de cada GET.
     */
    buildQueryTrigger(reportId, reportLen, parameter = 0x01) {
        const buf = new Uint8Array(8);
        buf[0] = this.REPORTS.PERMISSION_COMMAND;
        buf[1] = reportId;
        buf[2] = reportLen;
        buf[3] = 0x00;
        buf[4] = parameter & 0xFF;
        buf[5] = 0x00;
        buf[6] = 0x00;
        buf[7] = 0x00;
        return buf;
    },

    // =========================================================================
    // Tasa de sondeo (Report 0x06, 9 bytes)
    // [0]=0x06 [1]=0x09 [2]=profile [3]=code [4]=~code [5..8]=0
    // =========================================================================
    buildPollingRatePacket(rateHz) {
        const rateInfo = this.POLLING_RATES[rateHz] || this.POLLING_RATES[1000];
        const buf = new Uint8Array(9);
        buf[0] = this.REPORTS.POLLING;
        buf[1] = 0x09;
        buf[2] = 0x01;
        buf[3] = rateInfo.code;
        buf[4] = rateInfo.inv;
        buf[5] = 0x00;
        buf[6] = 0x00;
        buf[7] = 0x00;
        buf[8] = 0x00;
        return buf;
    },

    parsePollingRatePacket(data) {
        if (!data || data.length < 4) return 1000;
        // Los feature reports de WebHID incluyen el Report ID en data[0].
        const off = data[0] === this.REPORTS.POLLING ? 0 : -1;
        const code = data[3 + off];
        if (code === 0x01) return 1000;
        if (code === 0x02) return 500;
        if (code === 0x04) return 250;
        if (code === 0x08) return 125;
        return 1000;
    },

    // =========================================================================
    // Iluminación / preferencias (Report 0x05, 15 bytes)
    // [3]=(mode<<4) [4]=(deepSleep&0xF0)|speed [5]=((deepSleep&0x0F)<<4)|brightness
    // [6..8]=RGB [9]=sleepMin*2 [10]=responseMs/2 [11..12]=checksum [13..14]=0
    // =========================================================================
    buildRgbPacket({
        mode = 1,
        brightness = 5,
        speed = 3,
        r = 255,
        g = 0,
        b = 0,
        deepSleep = 0x0A,
        sleepTimerMin = 5,
        keyResponseMs = 4
    } = {}) {
        const buf = new Uint8Array(15);
        const lightMode = Math.max(0, Math.min(6, Number(mode) || 0));
        const bright = Math.max(1, Math.min(8, Number(brightness) || 5));
        const ledSpeed = Math.max(1, Math.min(5, Number(speed) || 3));
        const sleep = Math.max(0, Math.min(255, Number(deepSleep) || 0x0A));
        const sleepMin = Math.max(0.5, Math.min(30, Number(sleepTimerMin) || 5));

        buf[0] = this.REPORTS.LIGHTING;
        buf[1] = 0x0F;
        buf[2] = 0x01;
        buf[3] = (lightMode << 4) & 0xF0;
        buf[4] = (sleep & 0xF0) | (ledSpeed & 0x0F);
        buf[5] = ((sleep & 0x0F) << 4) | (bright & 0x0F);
        buf[6] = Math.max(0, Math.min(255, r));
        buf[7] = Math.max(0, Math.min(255, g));
        buf[8] = Math.max(0, Math.min(255, b));
        buf[9] = Math.max(1, Math.min(60, Math.round(sleepMin * 2)));
        buf[10] = Math.max(2, Math.min(25, Math.round((Number(keyResponseMs) || 4) / 2)));

        const [chkHi, chkLo] = this.calculateChecksum(buf, 3, 11);
        buf[11] = chkHi;
        buf[12] = chkLo;
        buf[13] = 0x00;
        buf[14] = 0x00;
        return buf;
    },

    parseRgbPacket(data) {
        const fallback = {
            mode: 1, brightness: 5, speed: 3, r: 255, g: 0, b: 0,
            deepSleep: 0x0A, sleepTimerMin: 5, keyResponseMs: 4
        };
        if (!data || data.length < 13) return fallback;
        const off = data[0] === this.REPORTS.LIGHTING ? 0 : -1;
        return {
            mode: (data[3 + off] >> 4) & 0x0F,
            deepSleep: ((data[4 + off] & 0xF0) | ((data[5 + off] >> 4) & 0x0F)),
            speed: data[4 + off] & 0x0F,
            brightness: data[5 + off] & 0x0F,
            r: data[6 + off],
            g: data[7 + off],
            b: data[8 + off],
            sleepTimerMin: (data[9 + off] || 10) / 2,
            keyResponseMs: (data[10 + off] || 2) * 2
        };
    },

    // =========================================================================
    // DPI (Report 0x04, 56 bytes)
    // La codificación NO es lineal: usa una tabla de 220 entradas (PAW3311).
    // =========================================================================
    DPI_3311: "01,02,03,04,05,06,08,09,0a,0b,0c,0e,0f,10,11,12,13,15,16,17,18,19,1b,1c,1d,1e,1f,20,22,23,24,25,26,27,29,2a,2b,2c,2d,2f,30,31,32,33,34,36,37,38,39,3a,3b,3d,3e,3f,40,41,43,44,45,46,47,48,4a,4b,4c,4d,4e,4f,51,52,53,54,55,57,58,59,5a,5b,5c,5e,5f,60,61,62,63,65,66,67,68,69,6b,6c,6d,6e,6f,70,72,73,74,75,76,77,79,7a,7b,7c,7d,7f,80,81,82,83,84,86,87,88,89,8a,8b,8d,8e,8f,90,91,93,94,95,96,97,98,9a,9b,9c,9d,9e,9f,a1,a2,a3,a4,a5,a7,a8,a9,aa,ab,ac,ae,af,b0,b1,b2,b3,b5,b6,b7,b8,b9,bb,bc,bd,be,bf,c0,c2,c3,c4,c5,c6,c7,c9,ca,cb,cc,cd,cf,d0,d1,d2,d3,d4,d6,d7,d8,d9,da,db,dd,de,df,e0,e1,e3,e4,e5,e6,e7,e8,ea,eb,76,77,79,7a,7b,7c,7d,7f,80,81,82,83,84,86,87,88,89,8a,8b,8d"
        .split(",").map(v => parseInt(v, 16)),

    /**
     * Convierte un DPI lógico a { low, high, double, triple }.
     * - <= 10000: paso de 50, high=0.
     * - 10100..12000: paso de 100, high=1.
     * - >12000..24000: se divide entre 2 y se marca "double".
     * - 24100..25000: se divide entre 3 y se marca "triple".
     */
    convertDpiToBytes(value) {
        let dpi = Math.max(50, Math.round(Number(value) || 50));
        let double = false;
        let triple = false;

        if (dpi >= 24100 && dpi <= 25000) {
            triple = true;
            dpi = Math.max(8000, Math.min(8500, Math.round(dpi / 3)));
        } else if (dpi > 24000) {
            // 24001..24099: el firmware no tiene un paso exacto aquí.
            dpi = 8500;
        } else if (dpi > 12000) {
            double = true;
            dpi = Math.round(dpi / 2);
        }

        let low;
        let high;
        if (dpi <= 10000) {
            dpi = Math.max(50, Math.min(10000, Math.round(dpi / 50) * 50));
            high = 0;
            low = this.DPI_3311[(dpi - 50) / 50];
        } else {
            dpi = Math.max(10100, Math.min(12000, Math.round(dpi / 100) * 100));
            high = 1;
            low = this.DPI_3311[200 + ((dpi - 10100) / 100)];
        }

        return { low, high, double, triple };
    },

    /**
     * Decodifica { low, high, double, triple } a DPI lógico.
     * lastIndexOf evita la ambigüedad de los valores repetidos de la tabla
     * entre el tramo de 50..10000 y el de 10100..12000.
     */
    convertBytesToDpi(low, high, doubleFlag = false, tripleFlag = false) {
        low = low & 0xFF;
        high = high & 0xFF;
        if (low === 0 && high === 0) return 0;

        let dpi = 0;
        if (high === 0) {
            const idx = this.DPI_3311.indexOf(low);
            if (idx >= 0 && idx < 200) dpi = idx * 50 + 50;
        } else if (high === 1) {
            let idx = this.DPI_3311.lastIndexOf(low);
            if (idx < 200) idx = 200 + Math.max(0, this.DPI_3311.slice(200).indexOf(low));
            dpi = (idx - 200) * 100 + 10100;
        } else {
            const combined = (high << 8) | low;
            const extra = combined - 199;
            dpi = 10100 + extra * 100;
        }

        if (doubleFlag) dpi = low === 0xEB ? 20100 : dpi * 2;
        if (tripleFlag) dpi = dpi * 3;
        return Math.max(0, Math.min(26000, Math.round(dpi)));
    },

    // Compatibilidad con llamadas antiguas.
    dpiToHardwareValue(dpi) {
        return this.convertDpiToBytes(dpi).low;
    },

    hardwareValueToDpi(value) {
        return this.convertBytesToDpi(value, 0, false, false);
    },

    /**
     * Construye el paquete de DPI (56 bytes).
     * stages: [{ dpi, r, g, b, enabled }] hasta 8 etapas.
     * activeStage: índice 0-based.
     */
    buildDpiPacket({
        activeStage = 0,
        stages = [],
        lod = 0,              // 0=1mm, 1=2mm, 2=0.7mm
        angleSnap = false,
        motionSync = true,
        rippleControl = false,
        dpiIndicator = 2      // 1=parpadeo, 2=fijo, 3=apagado
    } = {}) {
        const buf = new Uint8Array(56);
        const list = Array.isArray(stages) ? stages.slice(0, 8) : [];
        const lodValue = Math.max(0, Math.min(2, Number(lod) || 0));

        buf[0] = this.REPORTS.DPI;
        buf[1] = 0x38;
        buf[2] = 0x01;
        buf[3] = ((lodValue & 0x0F) << 4) | (angleSnap ? 0x01 : 0x00);
        buf[4] = (motionSync ? 0x10 : 0x00) | (rippleControl ? 0x01 : 0x00);

        let bitmask = 0;
        let doubleFlags = 0;
        let tripleFlags = 0;

        for (let i = 0; i < list.length; i++) {
            const st = list[i] || {};
            const enabled = st.enabled !== false;
            if (enabled) bitmask |= (1 << i);

            const encoded = enabled
                ? this.convertDpiToBytes(st.dpi || 1600)
                : { low: 0, high: 0, double: false, triple: false };

            buf[8 + i] = encoded.low;
            buf[16 + i] = encoded.high;
            if (encoded.double) doubleFlags |= (1 << i);
            if (encoded.triple) tripleFlags |= (1 << i);

            buf[25 + i * 3 + 0] = (st.r ?? 255) & 0xFF;
            buf[25 + i * 3 + 1] = (st.g ?? 0) & 0xFF;
            buf[25 + i * 3 + 2] = (st.b ?? 0) & 0xFF;
        }

        buf[5] = bitmask;
        buf[6] = doubleFlags;
        buf[7] = tripleFlags;

        const active = Math.max(0, Math.min(7, Number(activeStage) || 0));
        buf[24] = active + 1; // el firmware usa índice 1-based
        buf[49] = Math.max(1, Math.min(3, Number(dpiIndicator) || 2));

        const [chkHi, chkLo] = this.calculateChecksum(buf, 3, 50);
        buf[50] = chkHi;
        buf[51] = chkLo;
        return buf;
    },

    parseDpiPacket(data) {
        const fallbackStages = [
            { dpi: 800, r: 255, g: 0, b: 0, enabled: true },
            { dpi: 1600, r: 0, g: 255, b: 0, enabled: true },
            { dpi: 2400, r: 0, g: 0, b: 255, enabled: true },
            { dpi: 3200, r: 255, g: 255, b: 0, enabled: true },
            { dpi: 5000, r: 0, g: 255, b: 255, enabled: true },
            { dpi: 10000, r: 255, g: 0, b: 255, enabled: true }
        ];
        const fallback = {
            activeStage: 1,
            stages: fallbackStages,
            lod: 0,
            angleSnap: false,
            motionSync: true,
            rippleControl: false,
            dpiIndicator: 2
        };
        if (!data || data.length < 52) return fallback;

        const off = data[0] === this.REPORTS.DPI ? 0 : -1;
        const bitmask = data[5 + off];
        const doubleFlags = data[6 + off];
        const tripleFlags = data[7 + off];
        const stages = [];

        for (let i = 0; i < 8; i++) {
            const low = data[8 + i + off];
            const high = data[16 + i + off];
            const enabled = Boolean(bitmask & (1 << i));
            stages.push({
                dpi: this.convertBytesToDpi(low, high, Boolean(doubleFlags & (1 << i)), Boolean(tripleFlags & (1 << i))),
                r: data[25 + i * 3 + off],
                g: data[26 + i * 3 + off],
                b: data[27 + i * 3 + off],
                enabled
            });
        }

        return {
            activeStage: Math.max(0, Math.min(7, (data[24 + off] || 1) - 1)),
            stages: bitmask ? stages : fallbackStages,
            lod: (data[3 + off] >> 4) & 0x0F,
            angleSnap: Boolean(data[3 + off] & 0x01),
            motionSync: Boolean(data[4 + off] & 0x10),
            rippleControl: Boolean(data[4 + off] & 0x01),
            dpiIndicator: data[49 + off] || 2
        };
    },

    // =========================================================================
    // Mapeo de botones (Report 0x08, 59 bytes)
    // 18 slots de 3 bytes (acción, modificadores, usageId) desde offset 3.
    // Los botones de la UI se escriben en los slots 1,2,3,7,8 y 6 (DPI).
    // =========================================================================
    BUTTON_SLOT_MAP: [1, 2, 3, 7, 8, 6],

    // Al leer, el firmware reordena los slots. Para la UI:
    // izquierdo, derecho, rueda, adelante, atrás, DPI.
    BUTTON_READ_SLOT_MAP: [1, 2, 3, 5, 6, 8],

    buildButtonMappingPacket(buttonActions = []) {
        const buf = new Uint8Array(59);
        buf[0] = this.REPORTS.BUTTON_MAPPING;
        buf[1] = 0x3B;
        buf[2] = 0x01;

        const setSlot = (slot, action, modifiers = 0, usageId = 0) => {
            const offset = 3 + (slot - 1) * 3;
            buf[offset] = action & 0xFF;
            buf[offset + 1] = modifiers & 0xFF;
            buf[offset + 2] = usageId & 0xFF;
        };

        // Valores por defecto de los slots que no expone la UI.
        for (let slot = 1; slot <= 18; slot++) {
            setSlot(slot, 0x01);
        }
        setSlot(17, 0x09); // rueda arriba
        setSlot(18, 0x0A); // rueda abajo

        // Orden de la UI: izquierdo, derecho, rueda, adelante, atrás, DPI.
        for (let i = 0; i < this.BUTTON_SLOT_MAP.length; i++) {
            const action = buttonActions[i] !== undefined
                ? buttonActions[i]
                : this.MOUSE_BUTTONS[i].defaultAction;
            setSlot(this.BUTTON_SLOT_MAP[i], action);
        }

        const [chkHi, chkLo] = this.calculateChecksum(buf, 3, 57);
        buf[57] = chkHi;
        buf[58] = chkLo;
        return buf;
    },

    parseButtonMappingPacket(data) {
        if (!data || data.length < 59) {
            return this.MOUSE_BUTTONS.map(b => b.defaultAction);
        }
        const off = data[0] === this.REPORTS.BUTTON_MAPPING ? 0 : -1;
        return this.BUTTON_READ_SLOT_MAP.map(slot => {
            const offset = 3 + (slot - 1) * 3 + off;
            return data[offset];
        });
    },

    // =========================================================================
    // Eventos asíncronos (interfaz Events, Report ID 0x03)
    // event.data de WebHID NO incluye el Report ID:
    // [0]=0x55 [1]=código [2]=param1 [3]=param2
    // =========================================================================
    parseDeviceEvent(data) {
        if (!data || data.length < 4) return null;

        // Algunas rutas (p. ej. hidraw) incluyen el Report ID 0x03.
        const off = (data[0] === this.REPORTS.EVENT && data.length >= 5) ? 1 : 0;
        const deviceId = data[off];
        const code = data[off + 1];
        const param1 = data[off + 2];
        const param2 = data[off + 3];

        if (deviceId !== 0x55) return null;

        if (code === 0x40 || code === 0x41) {
            const status = param1;
            const percentage = Math.max(0, Math.min(100, param2));
            return {
                type: "battery",
                percentage,
                charging: status === 0x02 || status === 0x03,
                status
            };
        }

        if (code === 0x50) {
            return {
                type: "ack",
                success: param1 === 0x00,
                reportId: param2
            };
        }

        if (code === 0x10) {
            return {
                type: "dpiCycle",
                stage: Math.max(1, Math.min(8, param1))
            };
        }

        if (code === 0x80) {
            return { type: "profileChanged", profile: param1 };
        }

        return { type: "unknown", code, param1, param2 };
    },

    parseBatteryStatus(data) {
        const event = this.parseDeviceEvent(data);
        if (event && event.type === "battery") {
            return { percentage: event.percentage, charging: event.charging };
        }
        return { percentage: null, charging: false };
    }
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = Protocol;
}
