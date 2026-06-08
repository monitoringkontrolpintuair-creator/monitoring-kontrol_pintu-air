document.addEventListener("DOMContentLoaded", function() {
    const emptyData = {
        waterLevel: 0,
        waterDistance: null,
        waterStatus: "Menunggu data ESP32",
        waterLastUpdated: null,
        motorPosition: 0
    };

    let motorPosition = 0;

    function formatHistoryTime(timestamp) {
        return timestamp ? new Date(timestamp).toLocaleString("id-ID") : "-";
    }

    function escapeHtml(value) {
        return String(value ?? "-")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    async function loadDashboardPartials() {
        const partialContainers = document.querySelectorAll("[data-partial]:not([data-partial-loaded='true'])");

        if (partialContainers.length === 0) {
            return;
        }

        await Promise.all(Array.from(partialContainers).map(async (container) => {
            const partialPath = container.getAttribute("data-partial");

            try {
                const response = await fetch(partialPath);
                if (!response.ok) {
                    throw new Error(`Gagal memuat ${partialPath}`);
                }

                container.innerHTML = await response.text();
                container.setAttribute("data-partial-loaded", "true");
            } catch (err) {
                console.error("Partial load error:", err.message);
                container.setAttribute("data-partial-loaded", "true");
                container.innerHTML = `
                    <div class="alert alert-danger" role="alert">
                        Konten gagal dimuat. Silakan refresh halaman.
                    </div>
                `;
            }
        }));

        await loadDashboardPartials();
    }

    async function checkSession() {
        try {
            const response = await fetch("/api/me");
            if (!response.ok) {
                window.location.href = "/login.html";
                return false;
            }

            const data = await response.json();
            const usernameLabel = document.getElementById("usernameLabel");
            if (usernameLabel && data.username) {
                usernameLabel.innerText = data.username;
            }

            return true;
        } catch (err) {
            console.warn("Session check failed:", err.message);
            window.location.href = "/login.html";
            return false;
        }
    }
    
    // Function to update UI with data
    function updateUI(data) {
        // Network
        document.getElementById("lanIp").innerText = data.lanIpAddress || "-";
        document.getElementById("lanMac").innerText = data.lanMacAddr || "-";
        
        // Wireless
        document.getElementById("channel").innerText = data.channel || "-";
        
        // Data Rate
        document.getElementById("txRate").innerText = data.clientTxRate || "-";
        document.getElementById("rxRate").innerText = data.clientRxRate || "-";
        
        // Signal Quality
        document.getElementById("rssiValue").innerText = data.rssiValue || "-";
        document.getElementById("rssiCombined").innerText = data.rssiValueCombined || "-";
        document.getElementById("noiseStrength").innerText = data.noiseStrength ?? "-";
        document.getElementById("noiseValue").innerText = data.noiseValue || "-";
        document.getElementById("snr").innerText = data.snrValue || "-";
        
        if (data.waterLastUpdated) {
            updateWaterLevel({
                level: data.waterLevel || 0,
                distance: data.waterDistance,
                status: data.waterStatus,
                lastUpdated: data.waterLastUpdated
            });
        }
    }
    
    // Function to update water level display
    function updateWaterLevel(water) {
        const level = water.level;
        document.getElementById("waterLevel").innerText = level;
        
        // Update progress bar
        const maxLevel = 250;
        const percentage = Math.min((level / maxLevel) * 100, 100);
        document.getElementById("waterLevelBar").style.width = percentage + "%";
        
        const statusElement = document.querySelector("#waterLevel").parentElement.parentElement.querySelector("#waterStatus");

        if (water.status) {
            statusElement.innerText = water.status;
        } else if (water.distance === null || water.distance === undefined) {
            statusElement.innerText = "Menunggu data ESP32";
        } else if (level < 130) {
            statusElement.innerText = "Tinggi";
        } else if (level <= 160) {
            statusElement.innerText = "Normal";
        } else {
            statusElement.innerText = "Rendah";
        }

        if (statusElement.innerText === "Tinggi") {
            statusElement.style.color = "#dc3545";
        } else if (statusElement.innerText === "Normal") {
            statusElement.style.color = "#ffc107";
        } else if (statusElement.innerText === "Rendah") {
            statusElement.style.color = "#28a745";
        } else {
            statusElement.style.color = "#ffc107";
        }

        const lastUpdateElement = document.getElementById("waterLastUpdated");
        if (lastUpdateElement) {
            lastUpdateElement.innerText = water.lastUpdated
                ? new Date(water.lastUpdated).toLocaleTimeString("id-ID")
                : "-";
        }
    }
    
    // Function to fetch data from API
    async function loadData() {
        try {
            const response = await fetch("/api/cpe");
            
            if (!response.ok) {
                console.warn("API response not OK");
                updateUI(emptyData);
                return;
            }
            
            const data = await response.json();
            console.log("Data received from CPE210:", data);
            updateUI(data);
            loadHistory();
        } catch (err) {
            console.warn("Failed to fetch from API:", err.message);
            updateUI(emptyData);
        }
    }
    
    // Motor Control Functions
    async function controlMotor(direction) {
        const upBtn = document.getElementById("motorUpBtn");
        const downBtn = document.getElementById("motorDownBtn");
        const statusDiv = document.getElementById("motorStatus");
        
        // Disable buttons during operation
        upBtn.disabled = true;
        downBtn.disabled = true;
        statusDiv.innerHTML = 'Status: <span style="color: var(--accent-blue); font-weight: 600;">Bergerak...</span>';
        
        try {
            const response = await fetch("/api/motor", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ direction: direction })
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
                motorPosition = data.position;
                document.getElementById("motorPosition").innerText = motorPosition;
                
                // Update status
                if (direction === "up") {
                    statusDiv.innerHTML = 'Status: <span style="color: #28a745; font-weight: 600;">Naik</span>';
                } else {
                    statusDiv.innerHTML = 'Status: <span style="color: #28a745; font-weight: 600;">Turun</span>';
                }
                loadHistory();
                
                // Reset status after 2 seconds
                setTimeout(() => {
                    statusDiv.innerHTML = 'Status: <span style="color: var(--primary-blue); font-weight: 600;">Siap</span>';
                }, 2000);
            } else {
                statusDiv.innerHTML = 'Status: <span style="color: #dc3545; font-weight: 600;">Error</span>';
                console.error("Motor control error:", data.message);
            }
        } catch (err) {
            console.error("Motor control error:", err);
            statusDiv.innerHTML = 'Status: <span style="color: #dc3545; font-weight: 600;">Gagal</span>';
        } finally {
            // Re-enable buttons
            upBtn.disabled = false;
            downBtn.disabled = false;
        }
    }
    
    function setupMotorControls() {
        const motorUpBtn = document.getElementById("motorUpBtn");
        const motorDownBtn = document.getElementById("motorDownBtn");

        if (!motorUpBtn || !motorDownBtn) {
            console.warn("Motor control buttons not found");
            return;
        }

        motorUpBtn.addEventListener("click", () => {
            controlMotor("up");
        });

        motorDownBtn.addEventListener("click", () => {
            controlMotor("down");
        });
    }
    
    // Logout function
    async function logout() {
        try {
            await fetch("/api/logout", { method: "POST" });
        } catch (err) {
            console.warn("Logout request failed:", err.message);
        } finally {
            window.location.href = "/login.html";
        }
    }

    async function loadWaterData() {
        try {
            const response = await fetch("/api/water");

            if (!response.ok) {
                console.warn("Water API response not OK");
                return;
            }

            const data = await response.json();
            if (data.success && data.water) {
                updateWaterLevel(data.water);
            }
        } catch (err) {
            console.warn("Failed to fetch water data:", err.message);
        }
    }

    function renderServoHistory(items) {
        const historyBody = document.getElementById("servoHistoryBody");
        if (!historyBody) {
            return;
        }

        if (!items || items.length === 0) {
            historyBody.innerHTML = '<tr><td colspan="3" class="history-empty">Belum ada pergerakan servo</td></tr>';
            return;
        }

        historyBody.innerHTML = items.map((item) => `
            <tr>
                <td>${formatHistoryTime(item.timestamp)}</td>
                <td>
                    <span class="history-badge ${item.direction === "up" ? "history-up" : "history-down"}">
                        ${item.direction === "up" ? "Naik" : "Turun"}
                    </span>
                </td>
                <td>${escapeHtml(item.previousPosition)} -> ${escapeHtml(item.targetPosition)} step</td>
            </tr>
        `).join("");
    }

    function renderAntennaHistory(items) {
        const historyBody = document.getElementById("antennaHistoryBody");
        if (!historyBody) {
            return;
        }

        if (!items || items.length === 0) {
            historyBody.innerHTML = '<tr><td colspan="4" class="history-empty">Belum ada data antenna</td></tr>';
            return;
        }

        historyBody.innerHTML = items.map((item) => `
            <tr>
                <td>${formatHistoryTime(item.timestamp)}</td>
                <td>
                    <span class="history-main-value">${escapeHtml(item.rssiCombined)}</span>
                    <span class="history-sub-value">${escapeHtml(item.rssi)}</span>
                </td>
                <td>${escapeHtml(item.snr)}</td>
                <td>${escapeHtml(item.channel)}</td>
            </tr>
        `).join("");
    }

    async function loadHistory() {
        try {
            const response = await fetch("/api/history");

            if (!response.ok) {
                console.warn("History API response not OK");
                return;
            }

            const data = await response.json();
            if (data.success && data.history) {
                renderServoHistory(data.history.servo);
                renderAntennaHistory(data.history.antenna);
            }
        } catch (err) {
            console.warn("Failed to fetch history data:", err.message);
        }
    }
    
    // Setup logout button
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", logout);
    }
    
    async function initDashboard() {
        const isLoggedIn = await checkSession();
        if (!isLoggedIn) {
            return;
        }

        await loadDashboardPartials();
        setupMotorControls();
        updateUI(emptyData);
        loadData();
        loadWaterData();
        loadHistory();
        setInterval(loadData, 3000);
        setInterval(loadWaterData, 1000);
    }

    initDashboard();
});

// Sidebar Toggle
const hamburgerBtn = document.getElementById("hamburgerBtn");
const sidebar = document.getElementById("sidebar");
const mainContent = document.querySelector(".main-content");

hamburgerBtn.addEventListener("click", () => {

    if (window.innerWidth <= 768) {
        sidebar.classList.toggle("active");
    } else {
        sidebar.classList.toggle("closed");
        mainContent.classList.toggle("full");
    }

});