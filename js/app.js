/**
 * Attack Shark X11 - Driver UI Controller
 * Controla la interfaz de usuario, navegación por pestañas, eventos e integración con WebHID.
 */

document.addEventListener("DOMContentLoaded", () => {
    const hid = new WebHidManager();

    // Estado local de la aplicación
    const state = {
        connected: false,
        battery: { percentage: null, charging: false },
        isWired: false,
        activeTab: "dpi",
        activeDpiStage: 1, // 0 to 5 (mostrado 1 to 6)
        pollingRate: 1000,
        dpiStages: [
            { id: 1, dpi: 800, color: "#ff0000", enabled: true },
            { id: 2, dpi: 1600, color: "#00ff00", enabled: true },
            { id: 3, dpi: 2400, color: "#0077ff", enabled: true },
            { id: 4, dpi: 3200, color: "#ffff00", enabled: true },
            { id: 5, dpi: 5000, color: "#00ffff", enabled: true },
            { id: 6, dpi: 10000, color: "#ff00ff", enabled: true }
        ],
        rgb: {
            mode: 1,
            brightness: 5,
            speed: 4,
            color: "#ff0055"
        },
        sensor: {
            lod: 0,             // 0: 1mm, 1: 2mm, 2: 0.7mm
            debounceMs: 4,      // 2-20 ms (informativo; el X11 no lo expone por HID)
            sleepTimerMin: 5,   // 0.5-30 min
            lightOffSec: 30,    // informativo; no hay campo HID para esto
            motionSync: true,
            angleSnap: false,
            rippleControl: false,
            dpiIndicator: 2     // 1 parpadeo, 2 fijo, 3 apagado
        },
        buttons: [
            0x02, // Botón 1: Clic Izq
            0x03, // Botón 2: Clic Der
            0x04, // Botón 3: Clic Rueda
            0x06, // Botón 4: Adelante
            0x05, // Botón 5: Atrás
            0x0D  // Botón DPI: Ciclo de DPI
        ],
        profiles: ["Predeterminado", "Juegos FPS", "Productividad / Trabajo"]
    };

    // Cargar perfil guardado en LocalStorage si existe
    loadSavedSettings();

    // Elementos DOM principales
    const connectBtn = document.getElementById("connectBtn");
    const readMouseBtn = document.getElementById("readMouseBtn");
    const connectionStatusBadge = document.getElementById("connectionStatusBadge");
    const deviceNameEl = document.getElementById("deviceName");
    const batteryBadge = document.getElementById("batteryBadge");
    const batteryPercentageEl = document.getElementById("batteryPercentage");
    const batteryIconEl = document.getElementById("batteryIcon");
    const connectionTypeBadge = document.getElementById("connectionTypeBadge");

    // =========================================================================
    // Inicialización de la Interfaz
    // =========================================================================
    initTabs();
    initDpiSection();
    initPollingSection();
    initRgbSection();
    initSensorSection();
    initButtonSection();
    initProfilesSection();

    // Comprobar soporte WebHID
    if (!hid.isSupported()) {
        showToast("Tu navegador no soporta WebHID. Abre esta aplicación en Helium o Google Chrome.", "warning");
    } else {
        // Intentar autoconectar
        hid.checkExistingDevice();
    }

    // =========================================================================
    // Eventos de Conexión WebHID
    // =========================================================================
    connectBtn.addEventListener("click", async () => {
        if (state.connected) {
            hid.handleDisconnect();
            return;
        }

        try {
            connectBtn.disabled = true;
            connectBtn.innerHTML = `<span class="spinner"></span> Conectando...`;
            await hid.requestDevice();
        } catch (err) {
            showToast(err.message, "error");
        } finally {
            connectBtn.disabled = false;
            updateConnectionUI();
        }
    });

    hid.on("connected", async (info) => {
        state.connected = true;
        state.isWired = info.isWired;
        updateConnectionUI();
        showToast(`¡Attack Shark X11 conectado (${info.isWired ? "Cableado" : "Inalámbrico 2.4G"})!`, "success");
        showToast("Conexión segura: no se envían comandos automáticamente. Usa «Leer ratón» si quieres importar su configuración.", "info");
    });

    hid.on("disconnected", () => {
        state.connected = false;
        updateConnectionUI();
        showToast("El ratón se ha desconectado.", "warning");
    });

    hid.on("batteryUpdate", (battery) => {
        state.battery = battery;
        updateBatteryUI();
    });

    let dpiLedRestoreTimer = null;

    hid.on("dpiCycle", (event) => {
        state.activeDpiStage = Math.max(0, Math.min(state.dpiStages.length - 1, event.stage - 1));
        renderDpiStages();
        updateQuickDpi();

        // El firmware enciende el LED con el color de la nueva etapa DPI
        // durante ~1 s, incluso si el modo elegido es otro. Restauramos el
        // modo RGB del usuario para que el color no cambie "solo".
        if (state.connected && state.rgb.mode !== 5 && state.rgb.mode !== 6) {
            if (dpiLedRestoreTimer) clearTimeout(dpiLedRestoreTimer);
            dpiLedRestoreTimer = setTimeout(async () => {
                if (!state.connected) return;
                const c = hexToRgb(state.rgb.color);
                try {
                    await hid.setRgbLighting({
                        mode: state.rgb.mode,
                        brightness: state.rgb.brightness,
                        speed: state.rgb.speed,
                        r: c.r,
                        g: c.g,
                        b: c.b,
                        sleepTimerMin: state.sensor.sleepTimerMin,
                        keyResponseMs: state.sensor.debounceMs
                    });
                } catch (e) {
                    console.warn("No se pudo restaurar la iluminación tras cambiar DPI:", e);
                }
            }, 1000);
        }
    });

    hid.on("commandAck", (ack) => {
        if (!ack.success) {
            showToast(`El ratón rechazó el comando 0x${ack.reportId.toString(16)}. Vuelve a conectar el receptor si deja de responder.`, "warning");
        }
    });

    if (readMouseBtn) {
        readMouseBtn.addEventListener("click", async () => {
            if (!state.connected) return;
            readMouseBtn.disabled = true;
            const original = readMouseBtn.innerHTML;
            readMouseBtn.innerHTML = `<span class="spinner"></span> Leyendo...`;
            try {
                const current = await hid.readCurrentSettings();
                if (current) {
                    applyReadSettings(current);
                    if (current.errors.length) {
                        showToast("Algunos datos no se pudieron leer: " + current.errors[0], "warning");
                    } else {
                        showToast("Configuración leída del ratón.", "success");
                    }
                }
            } catch (e) {
                showToast("Error leyendo el ratón: " + e.message, "error");
            } finally {
                readMouseBtn.disabled = false;
                readMouseBtn.innerHTML = original;
            }
        });
    }

    function applyReadSettings(current) {
        if (current.pollingRate) {
            state.pollingRate = current.pollingRate;
            updatePollingUI();
        }
        if (current.rgb) {
            state.rgb.mode = current.rgb.mode;
            state.rgb.brightness = current.rgb.brightness;
            state.rgb.speed = current.rgb.speed;
            state.rgb.color = rgbToHex(current.rgb.r, current.rgb.g, current.rgb.b);
            if (current.rgb.sleepTimerMin) state.sensor.sleepTimerMin = Math.round(current.rgb.sleepTimerMin);
            updateRgbUI();
        }
        if (current.dpi && current.dpi.stages && current.dpi.stages.length > 0) {
            current.dpi.stages.forEach((st, idx) => {
                if (state.dpiStages[idx]) {
                    state.dpiStages[idx].dpi = st.dpi;
                    state.dpiStages[idx].color = rgbToHex(st.r, st.g, st.b);
                    state.dpiStages[idx].enabled = st.enabled;
                }
            });
            state.activeDpiStage = current.dpi.activeStage;
            state.sensor.lod = current.dpi.lod;
            state.sensor.angleSnap = current.dpi.angleSnap;
            state.sensor.motionSync = current.dpi.motionSync;
            state.sensor.rippleControl = current.dpi.rippleControl;
            state.sensor.dpiIndicator = current.dpi.dpiIndicator;
            renderDpiStages();
            syncSensorUI();
        }
        if (current.buttons) {
            state.buttons = current.buttons;
            initButtonSection();
        }
        updateRgbUI();
        updateQuickDpi();
        saveSettings();
    }

    function updateConnectionUI() {
        if (readMouseBtn) {
            readMouseBtn.style.display = state.connected ? "inline-flex" : "none";
        }
        if (state.connected) {
            connectBtn.innerHTML = `<i class="fa-solid fa-link-slash"></i> Desconectar`;
            connectBtn.className = "btn btn-danger";
            connectionStatusBadge.className = "status-badge online";
            connectionStatusBadge.innerHTML = `<span class="dot"></span> Conectado`;
            deviceNameEl.textContent = state.isWired ? "Attack Shark X11 (USB Cable)" : "Attack Shark X11 (2.4G Wireless)";
            connectionTypeBadge.textContent = state.isWired ? "Cable USB" : "Inalámbrico 2.4GHz";
            connectionTypeBadge.style.display = "inline-flex";
            batteryBadge.style.display = "inline-flex";
            updateBatteryUI();
        } else {
            connectBtn.innerHTML = `<i class="fa-solid fa-link"></i> Conectar Ratón`;
            connectBtn.className = "btn btn-primary";
            connectionStatusBadge.className = "status-badge offline";
            connectionStatusBadge.innerHTML = `<span class="dot"></span> Desconectado`;
            deviceNameEl.textContent = "Attack Shark X11 (Esperando conexión...)";
            connectionTypeBadge.style.display = "none";
            batteryBadge.style.display = "none";
        }
    }

    function updateBatteryUI() {
        const percentage = state.battery.percentage;
        if (percentage === null || percentage === undefined) {
            batteryPercentageEl.textContent = "--%";
            batteryIconEl.className = "fa-solid fa-battery-quarter text-muted";
            return;
        }
        batteryPercentageEl.textContent = `${percentage}%`;
        if (state.battery.charging) {
            batteryIconEl.className = "fa-solid fa-battery-bolt text-warning";
        } else if (percentage > 70) {
            batteryIconEl.className = "fa-solid fa-battery-full text-success";
        } else if (percentage > 30) {
            batteryIconEl.className = "fa-solid fa-battery-half text-info";
        } else {
            batteryIconEl.className = "fa-solid fa-battery-quarter text-danger";
        }
    }

    function updateQuickDpi() {
        const quick = document.getElementById("quickDpiVal");
        if (quick) {
            const stage = state.dpiStages[state.activeDpiStage];
            quick.textContent = stage ? `${stage.dpi} DPI` : "-- DPI";
        }
    }

    // =========================================================================
    // Sistema de Pestañas
    // =========================================================================
    function initTabs() {
        const tabBtns = document.querySelectorAll(".nav-tab");
        const tabPanes = document.querySelectorAll(".tab-pane");

        tabBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                const target = btn.dataset.tab;
                state.activeTab = target;

                tabBtns.forEach(b => b.classList.remove("active"));
                tabPanes.forEach(p => p.classList.remove("active"));

                btn.classList.add("active");
                const targetPane = document.getElementById(`tab-${target}`);
                if (targetPane) targetPane.classList.add("active");
            });
        });
    }

    // =========================================================================
    // Sección de DPI
    // =========================================================================
    function initDpiSection() {
        renderDpiStages();
        const applyDpiBtn = document.getElementById("applyDpiBtn");
        if (applyDpiBtn) {
            applyDpiBtn.addEventListener("click", async () => {
                await applyDpiSettings();
            });
        }
    }

    function renderDpiStages() {
        const container = document.getElementById("dpiStagesContainer");
        if (!container) return;
        container.innerHTML = "";

        state.dpiStages.forEach((stage, idx) => {
            const isActive = (state.activeDpiStage === idx);
            const card = document.createElement("div");
            card.className = `dpi-stage-card ${isActive ? "active" : ""} ${stage.enabled ? "" : "disabled"}`;
            card.dataset.index = idx;

            card.innerHTML = `
                <div class="dpi-card-header">
                    <label class="stage-toggle">
                        <input type="checkbox" ${stage.enabled ? "checked" : ""} class="stage-enable-chk" data-index="${idx}">
                        <span class="stage-title">Nivel ${stage.id}</span>
                    </label>
                    <input type="color" value="${stage.color}" class="stage-color-picker" data-index="${idx}" title="Color indicador de este nivel">
                </div>
                <div class="dpi-value-display" style="border-color: ${stage.color}">
                    <span class="dpi-number">${stage.dpi}</span>
                    <span class="dpi-unit">DPI</span>
                </div>
                <input type="range" class="dpi-slider" min="50" max="25000" step="50" value="${stage.dpi}" data-index="${idx}">
                <button class="btn btn-sm ${isActive ? "btn-active-stage" : "btn-outline"} select-stage-btn" data-index="${idx}">
                    ${isActive ? "Activo" : "Seleccionar"}
                </button>
            `;

            container.appendChild(card);
        });

        // Listeners para los controles de cada tarjeta
        container.querySelectorAll(".select-stage-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const idx = parseInt(e.currentTarget.dataset.index, 10);
                state.activeDpiStage = idx;
                renderDpiStages();
                if (state.connected) {
                    applyDpiSettings();
                }
            });
        });

        container.querySelectorAll(".dpi-slider").forEach(slider => {
            slider.addEventListener("input", (e) => {
                const idx = parseInt(e.target.dataset.index, 10);
                const val = parseInt(e.target.value, 10);
                state.dpiStages[idx].dpi = val;
                const card = e.target.closest(".dpi-stage-card");
                card.querySelector(".dpi-number").textContent = val;
            });
        });

        container.querySelectorAll(".stage-color-picker").forEach(picker => {
            picker.addEventListener("input", (e) => {
                const idx = parseInt(e.target.dataset.index, 10);
                state.dpiStages[idx].color = e.target.value;
                const card = e.target.closest(".dpi-stage-card");
                card.querySelector(".dpi-value-display").style.borderColor = e.target.value;

                // Mantener sincronizada la pestaña RGB cuando usa modo DPI.
                if (idx === state.activeDpiStage && (state.rgb.mode === 5 || state.rgb.mode === 6)) {
                    state.rgb.color = e.target.value;
                    updateRgbUI();
                }
            });
        });

        container.querySelectorAll(".stage-enable-chk").forEach(chk => {
            chk.addEventListener("change", (e) => {
                const idx = parseInt(e.target.dataset.index, 10);
                state.dpiStages[idx].enabled = e.target.checked;
                renderDpiStages();
            });
        });

        updateQuickDpi();

        // Si el RGB está en un modo basado en DPI, la vista previa debe
        // reflejar el color de la etapa activa.
        if (state.rgb.mode === 5 || state.rgb.mode === 6) {
            updateRgbUI();
        }
    }

    async function applyDpiSettings() {
        saveSettings();
        if (!state.connected) {
            showToast("Configuración de DPI guardada localmente (ratón desconectado).", "info");
            return;
        }

        try {
            const dpiConfig = {
                activeStage: state.activeDpiStage,
                stages: state.dpiStages.map(s => {
                    const rgb = hexToRgb(s.color);
                    return {
                        dpi: s.dpi,
                        r: rgb.r,
                        g: rgb.g,
                        b: rgb.b,
                        enabled: s.enabled
                    };
                })
            };
            await hid.setDpiStages(dpiConfig);
            showToast(`DPI actualizado: Nivel ${state.activeDpiStage + 1} (${state.dpiStages[state.activeDpiStage].dpi} DPI)`, "success");
        } catch (e) {
            showToast("Error aplicando DPI al ratón: " + e.message, "error");
        }
    }

    // =========================================================================
    // Sección de Tasa de Sondeo (Polling Rate)
    // =========================================================================
    function initPollingSection() {
        const rateCards = document.querySelectorAll(".polling-rate-card");
        rateCards.forEach(card => {
            card.addEventListener("click", async () => {
                const rate = parseInt(card.dataset.rate, 10);
                state.pollingRate = rate;
                updatePollingUI();
                saveSettings();

                if (state.connected) {
                    try {
                        await hid.setPollingRate(rate);
                        showToast(`Tasa de sondeo configurada a ${rate} Hz`, "success");
                    } catch (e) {
                        showToast("Error configurando sondeo: " + e.message, "error");
                    }
                }
            });
        });
        updatePollingUI();
    }

    function updatePollingUI() {
        document.querySelectorAll(".polling-rate-card").forEach(c => {
            const r = parseInt(c.dataset.rate, 10);
            if (r === state.pollingRate) {
                c.classList.add("active");
            } else {
                c.classList.remove("active");
            }
        });
    }

    // =========================================================================
    // Sección de Iluminación RGB
    // =========================================================================
    function initRgbSection() {
        const modeSelect = document.getElementById("rgbModeSelect");
        if (modeSelect) {
            modeSelect.innerHTML = "";
            Protocol.RGB_MODES.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m.id;
                opt.textContent = `${m.id}. ${m.name} (${m.en})`;
                modeSelect.appendChild(opt);
            });
            modeSelect.value = state.rgb.mode;

            modeSelect.addEventListener("change", (e) => {
                state.rgb.mode = parseInt(e.target.value, 10);

                // Los modos DPI usan el color de la etapa activa, no el color
                // genérico del reporte 0x05.
                if (state.rgb.mode === 5 || state.rgb.mode === 6) {
                    const stage = state.dpiStages[state.activeDpiStage];
                    if (stage) state.rgb.color = stage.color;
                    if (colorPicker) colorPicker.value = state.rgb.color;
                }

                updateRgbUI();
            });
        }

        const colorPicker = document.getElementById("rgbColorPicker");
        if (colorPicker) {
            colorPicker.value = state.rgb.color;
            colorPicker.addEventListener("input", (e) => {
                state.rgb.color = e.target.value;

                // En modos DPI el color visible es el de la etapa activa.
                if (state.rgb.mode === 5 || state.rgb.mode === 6) {
                    const stage = state.dpiStages[state.activeDpiStage];
                    if (stage) stage.color = state.rgb.color;
                }

                updateRgbUI();
            });

            colorPicker.addEventListener("change", () => {
                if (state.rgb.mode === 5 || state.rgb.mode === 6) {
                    renderDpiStages();
                }
            });
        }

        const brightnessSlider = document.getElementById("rgbBrightnessSlider");
        if (brightnessSlider) {
            brightnessSlider.value = state.rgb.brightness;
            brightnessSlider.addEventListener("input", (e) => {
                state.rgb.brightness = parseInt(e.target.value, 10);
                document.getElementById("rgbBrightnessVal").textContent = state.rgb.brightness;
            });
        }

        const speedSlider = document.getElementById("rgbSpeedSlider");
        if (speedSlider) {
            speedSlider.value = state.rgb.speed;
            speedSlider.addEventListener("input", (e) => {
                state.rgb.speed = parseInt(e.target.value, 10);
                document.getElementById("rgbSpeedVal").textContent = state.rgb.speed;
            });
        }

        // Swatches de color predefinidos
        document.querySelectorAll(".color-swatch").forEach(sw => {
            sw.addEventListener("click", () => {
                const col = sw.dataset.color;
                state.rgb.color = col;
                if (colorPicker) colorPicker.value = col;

                if (state.rgb.mode === 5 || state.rgb.mode === 6) {
                    const stage = state.dpiStages[state.activeDpiStage];
                    if (stage) stage.color = col;
                    renderDpiStages();
                }

                updateRgbUI();
            });
        });

        const applyRgbBtn = document.getElementById("applyRgbBtn");
        if (applyRgbBtn) {
            applyRgbBtn.addEventListener("click", async () => {
                // En los modos DPI el color se guarda en la etapa activa.
                if (state.rgb.mode === 5 || state.rgb.mode === 6) {
                    const stage = state.dpiStages[state.activeDpiStage];
                    if (stage) stage.color = state.rgb.color;
                }

                saveSettings();
                if (!state.connected) {
                    showToast("Configuración RGB guardada localmente.", "info");
                    return;
                }
                try {
                    const rgbColor = hexToRgb(state.rgb.color);

                    // Primero actualizamos los colores de las etapas DPI si el
                    // modo elegido depende de ellas (0x50 / 0x60).
                    if (state.rgb.mode === 5 || state.rgb.mode === 6) {
                        await hid.setDpiStages({
                            activeStage: state.activeDpiStage,
                            stages: state.dpiStages.map(s => {
                                const c = hexToRgb(s.color);
                                return {
                                    dpi: s.dpi,
                                    r: c.r,
                                    g: c.g,
                                    b: c.b,
                                    enabled: s.enabled
                                };
                            })
                        });
                    }

                    await hid.setRgbLighting({
                        mode: state.rgb.mode,
                        brightness: state.rgb.brightness,
                        speed: state.rgb.speed,
                        r: rgbColor.r,
                        g: rgbColor.g,
                        b: rgbColor.b,
                        sleepTimerMin: state.sensor.sleepTimerMin,
                        keyResponseMs: state.sensor.debounceMs
                    });
                    showToast("Efecto RGB aplicado con éxito.", "success");
                } catch (e) {
                    showToast("Error aplicando RGB: " + e.message, "error");
                }
            });
        }

        updateRgbUI();
    }

    function updateRgbUI() {
        const mode = state.rgb.mode;
        const isOff = mode === 0;
        const isAutomatic = mode === 3 || mode === 4;
        const isDpiMode = mode === 5 || mode === 6;
        const colorPicker = document.getElementById("rgbColorPicker");
        const note = document.getElementById("rgbModeNote");
        const preview = document.getElementById("rgbPreviewBox");

        // En los modos DPI el color que manda es el de la etapa activa.
        if (isDpiMode) {
            const stage = state.dpiStages[state.activeDpiStage];
            if (stage) {
                state.rgb.color = stage.color;
                if (colorPicker && colorPicker.value !== stage.color) {
                    colorPicker.value = stage.color;
                }
            }
        }

        if (colorPicker) colorPicker.disabled = isOff || isAutomatic;
        document.querySelectorAll(".color-swatch").forEach(sw => {
            sw.classList.toggle("is-disabled", isOff || isAutomatic);
        });

        if (preview) {
            if (isOff) {
                preview.style.background = "#111";
                preview.style.boxShadow = "none";
            } else if (isAutomatic) {
                preview.style.background =
                    "conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)";
                preview.style.boxShadow = "0 0 26px rgba(255, 255, 255, 0.25)";
            } else {
                preview.style.background = state.rgb.color;
                preview.style.boxShadow = `0 0 20px ${state.rgb.color}`;
            }
        }

        if (note) {
            if (isOff) {
                note.textContent = "La iluminación del ratón está apagada.";
            } else if (mode === 3) {
                note.textContent = "Neón usa colores automáticos del firmware; el color personalizado no se aplica en este modo.";
            } else if (mode === 4) {
                note.textContent = "Respiración multicolor usa colores automáticos del firmware; el color personalizado no se aplica en este modo.";
            } else if (isDpiMode) {
                note.textContent = `Este modo usa el color del Nivel DPI ${state.activeDpiStage + 1}. Al cambiar el color aquí se actualiza ese nivel.`;
            } else if (mode === 2) {
                note.textContent = "El color elegido se aplica al efecto de respiración.";
            } else {
                note.textContent = "El color elegido se aplica de forma fija.";
            }
        }
    }

    // =========================================================================
    // Sección de Sensor y Opciones Avanzadas
    // =========================================================================
    function initSensorSection() {
        const debounceSlider = document.getElementById("debounceSlider");
        if (debounceSlider) {
            debounceSlider.value = state.sensor.debounceMs;
            debounceSlider.addEventListener("input", (e) => {
                state.sensor.debounceMs = parseInt(e.target.value, 10);
                document.getElementById("debounceVal").textContent = `${state.sensor.debounceMs} ms`;
            });
        }
        const sleepSlider = document.getElementById("sleepSlider");
        if (sleepSlider) {
            sleepSlider.value = state.sensor.sleepTimerMin;
            sleepSlider.addEventListener("input", (e) => {
                state.sensor.sleepTimerMin = parseInt(e.target.value, 10);
                document.getElementById("sleepVal").textContent = `${state.sensor.sleepTimerMin} min`;
            });
        }

        const lightOffSlider = document.getElementById("lightOffSlider");
        if (lightOffSlider) {
            lightOffSlider.value = state.sensor.lightOffSec;
            lightOffSlider.addEventListener("input", (e) => {
                state.sensor.lightOffSec = parseInt(e.target.value, 10);
                document.getElementById("lightOffVal").textContent = `${state.sensor.lightOffSec} seg`;
            });
        }

        document.querySelectorAll("input[name='lodRadio']").forEach(radio => {
            radio.addEventListener("change", (e) => {
                if (e.target.checked) state.sensor.lod = parseInt(e.target.value, 10);
            });
        });

        const motionSyncChk = document.getElementById("motionSyncChk");
        if (motionSyncChk) {
            motionSyncChk.checked = state.sensor.motionSync;
            motionSyncChk.addEventListener("change", (e) => state.sensor.motionSync = e.target.checked);
        }

        const angleSnapChk = document.getElementById("angleSnapChk");
        if (angleSnapChk) {
            angleSnapChk.checked = state.sensor.angleSnap;
            angleSnapChk.addEventListener("change", (e) => state.sensor.angleSnap = e.target.checked);
        }

        const rippleChk = document.getElementById("rippleChk");
        if (rippleChk) {
            rippleChk.checked = state.sensor.rippleControl;
            rippleChk.addEventListener("change", (e) => state.sensor.rippleControl = e.target.checked);
        }

        const applySensorBtn = document.getElementById("applySensorBtn");
        if (applySensorBtn) {
            applySensorBtn.addEventListener("click", async () => {
                saveSettings();
                if (!state.connected) {
                    showToast("Configuración de sensor guardada localmente.", "info");
                    return;
                }
                try {
                    await hid.setSensorConfig(state.sensor);
                    showToast("Parámetros del sensor y energía aplicados.", "success");
                } catch (e) {
                    showToast("Error aplicando parámetros del sensor: " + e.message, "error");
                }
            });
        }

        syncSensorUI();
    }

    function syncSensorUI() {
        const debounceSlider = document.getElementById("debounceSlider");
        if (debounceSlider) debounceSlider.value = state.sensor.debounceMs;
        const debounceVal = document.getElementById("debounceVal");
        if (debounceVal) debounceVal.textContent = `${state.sensor.debounceMs} ms`;

        const sleepSlider = document.getElementById("sleepSlider");
        if (sleepSlider) sleepSlider.value = state.sensor.sleepTimerMin;
        const sleepVal = document.getElementById("sleepVal");
        if (sleepVal) sleepVal.textContent = `${state.sensor.sleepTimerMin} min`;

        const lightOffSlider = document.getElementById("lightOffSlider");
        if (lightOffSlider) lightOffSlider.value = state.sensor.lightOffSec;
        const lightOffVal = document.getElementById("lightOffVal");
        if (lightOffVal) lightOffVal.textContent = `${state.sensor.lightOffSec} seg`;

        document.querySelectorAll("input[name='lodRadio']").forEach(radio => {
            radio.checked = parseInt(radio.value, 10) === state.sensor.lod;
        });

        const motionSyncChk = document.getElementById("motionSyncChk");
        if (motionSyncChk) motionSyncChk.checked = state.sensor.motionSync;
        const angleSnapChk = document.getElementById("angleSnapChk");
        if (angleSnapChk) angleSnapChk.checked = state.sensor.angleSnap;
        const rippleChk = document.getElementById("rippleChk");
        if (rippleChk) rippleChk.checked = state.sensor.rippleControl;
    }

    // =========================================================================
    // Sección de Mapeo de Botones
    // =========================================================================
    function initButtonSection() {
        const container = document.getElementById("buttonMappingContainer");
        if (!container) return;
        container.innerHTML = "";

        const createRow = (btnInfo) => {
            const idx = btnInfo.index;
            const currentAction = state.buttons[idx] ?? btnInfo.defaultAction;
            const row = document.createElement("div");
            row.className = "button-mapping-row";

            let optionsHtml = "";
            Protocol.BUTTON_ACTIONS.forEach(act => {
                const selected = (act.id === currentAction) ? "selected" : "";
                optionsHtml += `<option value="${act.id}" ${selected}>${act.name} (${act.group})</option>`;
            });

            row.innerHTML = `
                <div class="btn-badge-label">
                    <span class="btn-number">${btnInfo.hidButton || "DPI"}</span>
                    <span class="btn-name">${btnInfo.label}</span>
                </div>
                <select class="form-select button-action-select" data-index="${idx}">
                    ${optionsHtml}
                </select>
            `;
            return row;
        };

        // Los 5 botones que el sistema ve como botones HID estándar.
        Protocol.MOUSE_BUTTONS.filter(b => !b.advanced).forEach(btnInfo => {
            container.appendChild(createRow(btnInfo));
        });

        // El botón DPI es un control de firmware aparte. Lo mostramos en una
        // sección avanzada para no hacer creer que el ratón tiene 6 botones.
        const advancedButtons = Protocol.MOUSE_BUTTONS.filter(b => b.advanced);
        if (advancedButtons.length) {
            const details = document.createElement("details");
            details.className = "mapping-advanced";
            const summary = document.createElement("summary");
            summary.innerHTML = `<i class="fa-solid fa-sliders"></i> Avanzado: botón DPI (no es un botón HID estándar)`;
            details.appendChild(summary);

            const note = document.createElement("p");
            note.className = "mapping-note";
            note.textContent = "El botón superior de DPI se configura por firmware. Linux no lo cuenta como un sexto botón del ratón; por eso aparece separado.";
            details.appendChild(note);

            advancedButtons.forEach(btnInfo => details.appendChild(createRow(btnInfo)));
            container.appendChild(details);
        }

        container.querySelectorAll(".button-action-select").forEach(sel => {
            sel.addEventListener("change", (e) => {
                const idx = parseInt(e.target.dataset.index, 10);
                state.buttons[idx] = parseInt(e.target.value, 10);
            });
        });

        const applyButtonsBtn = document.getElementById("applyButtonsBtn");
        if (applyButtonsBtn) {
            applyButtonsBtn.onclick = async () => {
                saveSettings();
                if (!state.connected) {
                    showToast("Mapeo guardado localmente.", "info");
                    return;
                }
                try {
                    await hid.setButtonMapping(state.buttons);
                    showToast("Mapeo de botones aplicado con éxito.", "success");
                } catch (e) {
                    showToast("Error aplicando botones: " + e.message, "error");
                }
            };
        }
    }

    // =========================================================================
    // Perfiles y Persistencia
    // =========================================================================
    function initProfilesSection() {
        const profileSelect = document.getElementById("profileSelect");
        if (profileSelect) {
            renderProfiles();
            profileSelect.addEventListener("change", (e) => {
                loadProfile(e.target.value);
            });
        }

        const exportBtn = document.getElementById("exportProfileBtn");
        if (exportBtn) {
            exportBtn.addEventListener("click", exportProfile);
        }

        const importInput = document.getElementById("importProfileInput");
        if (importInput) {
            importInput.addEventListener("change", importProfile);
        }
    }

    function renderProfiles() {
        const sel = document.getElementById("profileSelect");
        if (!sel) return;
        sel.innerHTML = "";
        state.profiles.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p;
            opt.textContent = p;
            sel.appendChild(opt);
        });
    }

    function saveSettings() {
        try {
            const data = {
                version: 2,
                dpiStages: state.dpiStages,
                activeDpiStage: state.activeDpiStage,
                pollingRate: state.pollingRate,
                rgb: state.rgb,
                sensor: state.sensor,
                buttons: state.buttons
            };
            localStorage.setItem("attack_shark_x11_settings", JSON.stringify(data));
        } catch (e) {
            console.error("Error guardando settings:", e);
        }
    }

    function loadSavedSettings() {
        try {
            const raw = localStorage.getItem("attack_shark_x11_settings");
            if (raw) {
                const data = JSON.parse(raw);
                if (data.dpiStages) state.dpiStages = data.dpiStages;
                if (data.activeDpiStage !== undefined) state.activeDpiStage = data.activeDpiStage;
                if (data.pollingRate) state.pollingRate = data.pollingRate;
                if (data.rgb) state.rgb = { ...state.rgb, ...data.rgb };
                if (data.sensor) state.sensor = { ...state.sensor, ...data.sensor };
                // La versión 1 guardaba IDs de acción equivocados y trataba el
                // botón DPI como un sexto botón HID. Se restablece el mapeo.
                if (data.version === 2 && Array.isArray(data.buttons) && data.buttons.length === 6) {
                    state.buttons = data.buttons;
                }
            }
        } catch (e) {
            console.warn("No se pudieron cargar settings guardados:", e);
        }
    }

    function exportProfile() {
        const profileData = {
            name: "Attack Shark X11 Profile",
            createdAt: new Date().toISOString(),
            settings: {
                version: 2,
                dpiStages: state.dpiStages,
                activeDpiStage: state.activeDpiStage,
                pollingRate: state.pollingRate,
                rgb: state.rgb,
                sensor: state.sensor,
                buttons: state.buttons
            }
        };

        const blob = new Blob([JSON.stringify(profileData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `attack_shark_x11_profile_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("Perfil exportado correctamente.", "success");
    }

    function importProfile(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                if (parsed.settings) {
                    const s = parsed.settings;
                    if (s.dpiStages) state.dpiStages = s.dpiStages;
                    if (s.activeDpiStage !== undefined) state.activeDpiStage = s.activeDpiStage;
                    if (s.pollingRate) state.pollingRate = s.pollingRate;
                    if (s.rgb) state.rgb = s.rgb;
                    if (s.sensor) state.sensor = s.sensor;
                    if (s.version === 2 && Array.isArray(s.buttons) && s.buttons.length === 6) {
                        state.buttons = s.buttons;
                    }

                    renderDpiStages();
                    updatePollingUI();
                    updateRgbUI();
                    initSensorSection();
                    initButtonSection();
                    saveSettings();
                    showToast("Perfil importado y cargado con éxito.", "success");
                }
            } catch (err) {
                showToast("Archivo de perfil JSON inválido.", "error");
            }
        };
        reader.readAsText(file);
    }

    function loadProfile(name) {
        // En una implementación extendida se pueden guardar múltiples presets
        showToast(`Perfil "${name}" cargado.`, "info");
    }

    // =========================================================================
    // Helpers y Notificaciones Toast
    // =========================================================================
    function showToast(message, type = "info") {
        const container = document.getElementById("toastContainer");
        if (!container) return;

        const toast = document.createElement("div");
        toast.className = `toast-alert toast-${type}`;
        
        let icon = "fa-circle-info";
        if (type === "success") icon = "fa-circle-check";
        if (type === "error") icon = "fa-triangle-exclamation";
        if (type === "warning") icon = "fa-circle-exclamation";

        toast.innerHTML = `
            <i class="fa-solid ${icon}"></i>
            <span>${message}</span>
        `;

        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateX(50px)";
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    function hexToRgb(hex) {
        let clean = hex.replace("#", "");
        if (clean.length === 3) {
            clean = clean.split("").map(c => c + c).join("");
        }
        const num = parseInt(clean, 16);
        return {
            r: (num >> 16) & 255,
            g: (num >> 8) & 255,
            b: num & 255
        };
    }

    function rgbToHex(r, g, b) {
        return "#" + [r, g, b].map(x => {
            const hex = (x || 0).toString(16);
            return hex.length === 1 ? "0" + hex : hex;
        }).join("");
    }
});
