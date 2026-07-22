document.addEventListener("DOMContentLoaded", function() {
    const hamburgerBtn = document.getElementById("hamburgerBtn");
    const sidebar = document.getElementById("sidebar");
    const mainContent = document.querySelector(".main-content");

    // Sidebar helpers: mengatur tampilan menu samping pada layar besar dan kecil.
    function setSidebarExpanded(isExpanded) {
        if (!hamburgerBtn) {
            return;
        }

        hamburgerBtn.classList.toggle("active", isExpanded);
        hamburgerBtn.setAttribute("aria-expanded", String(isExpanded));
    }

    function setupSidebar() {
        if (!hamburgerBtn || !sidebar || !mainContent) {
            return;
        }

        setSidebarExpanded(window.innerWidth > 768);

        hamburgerBtn.addEventListener("click", () => {
            if (window.innerWidth <= 768) {
                const isOpen = sidebar.classList.toggle("active");
                setSidebarExpanded(isOpen);
                return;
            }

            const isClosed = sidebar.classList.toggle("closed");
            mainContent.classList.toggle("full", isClosed);
            setSidebarExpanded(!isClosed);
        });

        sidebar.querySelectorAll(".nav-link").forEach((link) => {
            link.addEventListener("click", () => {
                if (window.innerWidth <= 768) {
                    sidebar.classList.remove("active");
                    setSidebarExpanded(false);
                }
            });
        });

        window.addEventListener("resize", () => {
            if (window.innerWidth <= 768) {
                sidebar.classList.remove("closed");
                mainContent.classList.remove("full");
                setSidebarExpanded(sidebar.classList.contains("active"));
                return;
            }

            sidebar.classList.remove("active");
            setSidebarExpanded(!sidebar.classList.contains("closed"));
        });
    }

    // UI helpers: update waktu dashboard dan status refresh.
    function updateDashboardClock() {
        const dashboardClock = document.getElementById("dashboardClock");
        if (!dashboardClock) {
            return;
        }

        dashboardClock.innerText = new Date().toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
    }

    function setDashboardDataStatus(statusText) {
        const apiStatusText = document.getElementById("apiStatusText");
        if (apiStatusText) {
            apiStatusText.innerText = statusText;
        }
    }

    function setLastRefreshTime() {
        const lastRefreshTime = document.getElementById("lastRefreshTime");
        if (lastRefreshTime) {
            lastRefreshTime.innerText = new Date().toLocaleTimeString("id-ID");
        }
    }

    // Data default untuk halaman saat API offline atau belum ada data.
    const emptyData = {
        waterLevel: 0,
        waterDistance: null,
        waterStatus: "Menunggu data ESP32",
        waterLastUpdated: null,
        motorPosition: 0
    };

    const signalTrendState = { labels: [], rssi: [], snr: [] };
    const pingTrendState = { labels: [], latency: [] };
    const qosTrendState = { labels: [], packetLoss: [], delay: [], jitter: [], throughput: [] };
    const pingHistoryData = []; // New: Store full ping history for charts
    const MAX_CHART_POINTS = 18;

    let motorPosition = 0;
    let pingIntervalId = null;
    let latencyChart = null;
    let packetComparisonChart = null;
    let packetLossChart = null;

    // Utilitas kecil: format timestamp dan sanitasi teks untuk HTML.
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

    function toNumber(value) {
        if (value === null || value === undefined || value === "") {
            return null;
        }

        if (typeof value === "number") {
            return Number.isFinite(value) ? value : null;
        }

        const text = String(value).trim();
        if (text === "-" || text.toLowerCase() === "na") {
            return null;
        }

        const match = text.match(/[-+]?\d+(?:\.\d+)?/);
        if (match) {
            const parsed = Number(match[0]);
            return Number.isFinite(parsed) ? parsed : null;
        }

        const parsed = Number(text);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function formatClockLabel(timestamp) {
        return new Date(timestamp).toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
    }

    function formatNumber(value, digits = 1) {
        const number = toNumber(value);
        return number === null ? "-" : number.toFixed(digits);
    }

    function formatMetric(value, unit, digits = 1) {
        const number = toNumber(value);
        if (number === null) {
            return "-";
        }

        return unit === "%" ? `${number.toFixed(digits)}%` : `${number.toFixed(digits)} ${unit}`;
    }

    // Chart renderer: menggambar grafik garis sederhana langsung ke elemen <canvas>.
    function drawLineChart(canvasId, labels, datasets) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            return;
        }

        const context = canvas.getContext("2d");
        if (!context) {
            return;
        }

        const width = canvas.width;
        const height = canvas.height;
        context.clearRect(0, 0, width, height);

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);

        const padding = { top: 18, right: 16, bottom: 28, left: 42 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        context.strokeStyle = "#dbeafe";
        context.lineWidth = 1;

        const allValues = datasets.flatMap((dataset) => dataset.data.filter((value) => Number.isFinite(value)));
        const maxValue = allValues.length ? Math.max(...allValues) : 1;
        const minValue = allValues.length ? Math.min(...allValues) : 0;
        const valueRange = Math.max(maxValue - minValue, 1);

        for (let i = 0; i <= 4; i += 1) {
            const y = padding.top + (chartHeight / 4) * i;
            context.beginPath();
            context.moveTo(padding.left, y);
            context.lineTo(width - padding.right, y);
            context.stroke();

            const value = maxValue - (valueRange / 4) * i;
            context.fillStyle = "#5d6d7e";
            context.font = "11px Segoe UI";
            context.fillText(Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1), 4, y + 4);
        }

        context.fillStyle = "#5d6d7e";
        context.font = "11px Segoe UI";
        labels.forEach((label, index) => {
            const x = padding.left + (chartWidth / Math.max(labels.length - 1, 1)) * index;
            context.fillText(label, x - 18, height - 8);
        });

        datasets.forEach((dataset) => {
            if (!dataset.data.length) {
                return;
            }

            context.beginPath();
            dataset.data.forEach((value, index) => {
                const x = padding.left + (chartWidth / Math.max(dataset.data.length - 1, 1)) * index;
                const normalized = (value - minValue) / valueRange;
                const y = padding.top + chartHeight - normalized * chartHeight;

                if (index === 0) {
                    context.moveTo(x, y);
                } else {
                    context.lineTo(x, y);
                }
            });

            context.strokeStyle = dataset.color;
            context.lineWidth = 2;
            context.stroke();
        });

        if (!labels.length || !datasets.some((dataset) => dataset.data.length)) {
            context.fillStyle = "#66798f";
            context.font = "13px Segoe UI";
            context.fillText("Belum ada data CPE210 untuk ditampilkan", 48, height / 2);
        }
    }

    // Signal trend: update data RSSI dan SNR untuk chart CPE.
    function updateSignalTrend(data) {
        const rssiValue = toNumber(data.rssiValueCombined ?? data.rssiValue ?? data.rssi);
        const snrValue = toNumber(data.snrValue ?? data.snr);

        if (rssiValue !== null || snrValue !== null) {
            signalTrendState.labels.push(formatClockLabel(Date.now()));
            signalTrendState.rssi.push(rssiValue ?? 0);
            signalTrendState.snr.push(snrValue ?? 0);

            if (signalTrendState.labels.length > MAX_CHART_POINTS) {
                signalTrendState.labels.shift();
                signalTrendState.rssi.shift();
                signalTrendState.snr.shift();
            }

            drawLineChart("cpeRssiChart", signalTrendState.labels, [
                { label: "RSSI", color: "#0066cc", data: signalTrendState.rssi }
            ]);

            drawLineChart("cpeSnrChart", signalTrendState.labels, [
                { label: "SNR", color: "#00b894", data: signalTrendState.snr }
            ]);
        }
    }

    // Ping chart: tambahkan hasil ping ke grafik latency.
    function updatePingChart(result) {
        if (!result || !Number.isFinite(result.avgLatencyMs)) {
            return;
        }

        pingTrendState.labels.push(formatClockLabel(result.timestamp || Date.now()));
        pingTrendState.latency.push(result.avgLatencyMs);

        if (pingTrendState.labels.length > MAX_CHART_POINTS) {
            pingTrendState.labels.shift();
            pingTrendState.latency.shift();
        }

        drawLineChart("pingChart", pingTrendState.labels, [
            { label: "Latency", color: "#ff7a59", data: pingTrendState.latency }
        ]);

        // New: Also update the new chart system
        pingHistoryData.push(result);
        if (pingHistoryData.length > 20) {
            pingHistoryData.shift();
        }
        updateAllPingCharts();
    }

    function resetCharts() {
        drawLineChart("cpeRssiChart", [], []);
        drawLineChart("cpeSnrChart", [], []);
        drawLineChart("pingChart", [], []);
        drawLineChart("qosTrendChart", [], []);
    }

    // Partial loader: muat ulang HTML kecil untuk setiap tab dashboard.
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

    // Session checker: pastikan user masih login sebelum tampilkan dashboard.
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
    // UI updater: isi seluruh tampilan dashboard dengan data dari server.
    function updateUI(data) {
        updateSignalTrend(data);

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
    // Water level renderer: update tampilan level dan status air.
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
        } else if (level >= 52 && level <= 75) {
            statusElement.innerText = "Aman";
        } else if (level >= 42 && level <= 51) {
            statusElement.innerText = "Siaga";
        } else if (level >= 20 && level <= 41) {
            statusElement.innerText = "Bahaya";
        } else if (level > 75) {
            statusElement.innerText = "Aman";
        } else {
            statusElement.innerText = "Bahaya";
        }

        if (statusElement.innerText === "Aman") {
            statusElement.style.color = "#28a745";
        } else if (statusElement.innerText === "Siaga") {
            statusElement.style.color = "#ffc107";
        } else if (statusElement.innerText === "Bahaya") {
            statusElement.style.color = "#dc3545";
        } else {
            statusElement.style.color = "#66798f";
        }

        const lastUpdateElement = document.getElementById("waterLastUpdated");
        if (lastUpdateElement) {
            lastUpdateElement.innerText = water.lastUpdated
                ? new Date(water.lastUpdated).toLocaleTimeString("id-ID")
                : "-";
        }
    }
    
    // Function to fetch data from API
    // Fetch data CPE: panggil endpoint `/api/cpe` dan tampilkan hasilnya di dashboard.
    async function loadData() {
        try {
            const response = await fetch("/api/cpe");
            
            if (!response.ok) {
                console.warn("API response not OK");
                setDashboardDataStatus("Offline");
                updateUI(emptyData);
                return;
            }
            
            const data = await response.json();
            console.log("Data received from CPE210:", data);
            setDashboardDataStatus("Online");
            setLastRefreshTime();
            updateUI(data);
            loadHistory();
        } catch (err) {
            console.warn("Failed to fetch from API:", err.message);
            setDashboardDataStatus("Offline");
            updateUI(emptyData);
        }
    }

    function updateQosTrend(qos) {
        if (!qos) {
            return;
        }

        qosTrendState.labels.push(formatClockLabel(qos.timestamp || Date.now()));
        qosTrendState.packetLoss.push(toNumber(qos.packetLoss) ?? 0);
        qosTrendState.delay.push(toNumber(qos.delayMs) ?? 0);
        qosTrendState.jitter.push(toNumber(qos.jitterMs) ?? 0);
        qosTrendState.throughput.push(toNumber(qos.throughputMbps) ?? 0);

        if (qosTrendState.labels.length > MAX_CHART_POINTS) {
            qosTrendState.labels.shift();
            qosTrendState.packetLoss.shift();
            qosTrendState.delay.shift();
            qosTrendState.jitter.shift();
            qosTrendState.throughput.shift();
        }

        drawLineChart("qosTrendChart", qosTrendState.labels, [
            { label: "Packet Loss (%)", color: "#ff5c77", data: qosTrendState.packetLoss },
            { label: "Delay (ms)", color: "#0066cc", data: qosTrendState.delay },
            { label: "Jitter (ms)", color: "#00b894", data: qosTrendState.jitter },
            { label: "Throughput (Mbps)", color: "#ff9f1c", data: qosTrendState.throughput }
        ]);
    }

    function renderQosHistory(items) {
        const historyBodies = document.querySelectorAll(".js-qos-history-body");
        if (!historyBodies.length) {
            return;
        }

        if (!items || items.length === 0) {
            historyBodies.forEach((historyBody) => {
                historyBody.innerHTML = '<tr><td colspan="6" class="history-empty">Belum ada riwayat QoS</td></tr>';
            });
            return;
        }

        const rows = items.map((item) => `
            <tr>
                <td>${formatHistoryTime(item.timestamp)}</td>
                <td>${formatMetric(item.packetLoss, "%")}</td>
                <td>${formatMetric(item.throughputMbps, "Mbps")}</td>
                <td>${formatMetric(item.delayMs, "ms")}</td>
                <td>${formatMetric(item.jitterMs, "ms")}</td>
                <td>${escapeHtml(item.host || "-")}</td>
            </tr>
        `).join("");

        historyBodies.forEach((historyBody) => {
            historyBody.innerHTML = rows;
        });
    }

    function updateQosUI(qos, historyItems) {
        if (!qos) {
            return;
        }

        setText("qosPacketLoss", formatMetric(qos.packetLoss, "%"));
        setText("qosThroughput", formatMetric(qos.throughputMbps, "Mbps"));
        setText("qosDelay", formatMetric(qos.delayMs, "ms"));
        setText("qosJitter", formatMetric(qos.jitterMs, "ms"));
        setText("qosTxThroughput", formatMetric(qos.txThroughputMbps, "Mbps"));
        setText("qosRxThroughput", formatMetric(qos.rxThroughputMbps, "Mbps"));
        setText("qosHost", qos.host || "-");
        setText("qosSent", qos.packetsSent ?? "-");
        setText("qosReceived", qos.packetsReceived ?? "-");
        setText("qosUpdatedAt", qos.timestamp ? new Date(qos.timestamp).toLocaleString("id-ID") : "-");

        updateQosTrend(qos);
        renderQosHistory(historyItems);
    }

    async function loadQosData() {
        try {
            const response = await fetch("/api/qos");
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || "Gagal mengambil data QoS");
            }

            updateQosUI(data.qos, data.history);
        } catch (err) {
            console.warn("Failed to fetch QoS data:", err.message);
            setText("qosUpdatedAt", "QoS offline");
        }
    }
    
    // Ping helper: jalankan ping sekali dan update indikator serta grafik.
    async function runPingOnce(host, statusElement) {
        try {
            const response = await fetch(`/api/ping?host=${encodeURIComponent(host)}&count=4`);
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || "Gagal menjalankan ping");
            }

            const ping = data.ping || {};
            const lossText = ping.packetLoss === null || ping.packetLoss === undefined
                ? "-"
                : `${ping.packetLoss.toFixed(1)}% loss`;
            const latencyText = ping.avgLatencyMs === null || ping.avgLatencyMs === undefined
                ? "-"
                : `${ping.avgLatencyMs.toFixed(1)} ms`;

            statusElement.innerText = `Hasil terbaru: ${latencyText}, loss ${lossText} (${ping.host || host})`;
            updatePingChart(ping);
            return true;
        } catch (err) {
            console.error("Ping test failed:", err.message);
            statusElement.innerText = `Ping gagal: ${err.message}`;
            return false;
        }
    }

    // Ping loop control: berhentikan loop ping otomatis.
    function stopPingLoop() {
        const startButton = document.getElementById("runPingBtn");
        const stopButton = document.getElementById("stopPingBtn");
        const status = document.getElementById("pingStatus");

        if (pingIntervalId) {
            clearInterval(pingIntervalId);
            pingIntervalId = null;
        }

        if (startButton) {
            startButton.disabled = false;
            startButton.innerText = "Start Ping";
        }

        if (stopButton) {
            stopButton.disabled = true;
        }

        if (status) {
            status.innerText = "Ping dihentikan. Klik Start Ping untuk menjalankan terus-menerus lagi.";
        }
    }

    // New: Render latency trend chart with Chart.js
    // Chart rendering untuk ping: grafik latency, sent/received, dan lost.
    function renderLatencyTrendChart() {
        const canvasElement = document.getElementById("latencyTrendChart");
        if (!canvasElement) return;

        const ctx = canvasElement.getContext("2d");
        
        if (latencyChart) {
            latencyChart.destroy();
        }

        const labels = pingHistoryData.map((item, idx) => {
            const date = new Date(item.timestamp);
            return date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        });

        const latencyValues = pingHistoryData.map(item => item.avgLatencyMs || 0);

        latencyChart = new Chart(ctx, {
            type: "line",
            data: {
                labels: labels,
                datasets: [{
                    label: "Latency (ms)",
                    data: latencyValues,
                    borderColor: "#ff7a59",
                    backgroundColor: "rgba(255, 122, 89, 0.1)",
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: "#ff7a59",
                    pointBorderColor: "#fff",
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: true,
                        position: "top"
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: "Latency (ms)"
                        }
                    }
                }
            }
        });
    }

    // New: Render packet comparison chart (Sent vs Received)
    function renderPacketComparisonChart() {
        const canvasElement = document.getElementById("packetComparisonChart");
        if (!canvasElement) return;

        const ctx = canvasElement.getContext("2d");
        
        if (packetComparisonChart) {
            packetComparisonChart.destroy();
        }

        const labels = pingHistoryData.map((item, idx) => `Ping ${pingHistoryData.length - idx}`).reverse();
        const sentData = pingHistoryData.map(item => item.packetsSent || 0).reverse();
        const receivedData = pingHistoryData.map(item => item.packetsReceived || 0).reverse();

        packetComparisonChart = new Chart(ctx, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [
                    {
                        label: "Sent",
                        data: sentData,
                        backgroundColor: "#0066cc",
                        borderColor: "#0052a3",
                        borderWidth: 1
                    },
                    {
                        label: "Received",
                        data: receivedData,
                        backgroundColor: "#00b894",
                        borderColor: "#009470",
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: true,
                        position: "top"
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    // New: Render packet loss pie chart
    function renderPacketLossChart() {
        const canvasElement = document.getElementById("packetLossChart");
        if (!canvasElement) return;

        const ctx = canvasElement.getContext("2d");
        
        if (packetLossChart) {
            packetLossChart.destroy();
        }

        // Use latest ping data for pie chart
        if (pingHistoryData.length === 0) {
            return;
        }

        const latestPing = pingHistoryData[pingHistoryData.length - 1];
        const received = latestPing.packetsReceived || 0;
        const lost = (latestPing.packetsSent || 0) - received;

        packetLossChart = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels: ["Received", "Lost"],
                datasets: [{
                    data: [received, Math.max(0, lost)],
                    backgroundColor: [
                        "#00b894",
                        "#ff7a59"
                    ],
                    borderColor: [
                        "#009470",
                        "#ff5733"
                    ],
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: true,
                        position: "bottom"
                    }
                }
            }
        });
    }

    // New: Render ping history table
    // Tabel history ping: tampilkan data hasil ping terakhir.
    function renderPingHistoryTable() {
        const historyBody = document.getElementById("pingHistoryBody");
        if (!historyBody) return;

        if (!pingHistoryData || pingHistoryData.length === 0) {
            historyBody.innerHTML = '<tr><td colspan="8" class="history-empty">Belum ada history ping</td></tr>';
            return;
        }

        historyBody.innerHTML = [...pingHistoryData].reverse().map((item) => {
            const time = new Date(item.timestamp).toLocaleTimeString("id-ID");
            const loss = item.packetLoss !== null ? `${item.packetLoss.toFixed(1)}%` : "-";
            const rttMin = item.minLatencyMs != null ? `${item.minLatencyMs.toFixed(1)} ms` : "-";
            const rttAvg = item.avgLatencyMs != null ? `${item.avgLatencyMs.toFixed(1)} ms` : "-";
            const rttMax = item.maxLatencyMs != null ? `${item.maxLatencyMs.toFixed(1)} ms` : "-";
            const lossClass = item.packetLoss > 0 ? 'style="color:#dc3545;font-weight:600"' : 'style="color:#28a745;font-weight:600"';

            return `
                <tr>
                    <td>${time}</td>
                    <td>${escapeHtml(item.host || "-")}</td>
                    <td>${item.packetsSent || "-"}</td>
                    <td>${item.packetsReceived || "-"}</td>
                    <td ${lossClass}>${loss}</td>
                    <td>${rttMin}</td>
                    <td>${rttAvg}</td>
                    <td>${rttMax}</td>
                </tr>
            `;
        }).join("");
    }

    // New: Update all ping charts
    // Satukan semua chart ping menjadi satu fungsi update.
    function updateAllPingCharts() {
        renderLatencyTrendChart();
        renderPacketComparisonChart();
        renderPacketLossChart();
        renderPingHistoryTable();
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.innerText = value;
        }
    }

    function updatePingResultDisplay(pingResult, host) {
        const resultDiv = document.getElementById("pingResult");
        if (resultDiv) {
            resultDiv.classList.remove("d-none");
        }

        setText("resultHost", pingResult.host || host);
        setText("resultSent", pingResult.packetsSent ?? "-");
        setText("resultReceived", pingResult.packetsReceived ?? "-");
        setText("resultLoss", pingResult.packetLoss !== null && pingResult.packetLoss !== undefined
            ? `${pingResult.packetLoss.toFixed(1)}%`
            : "-");
        setText("resultMin", pingResult.minLatencyMs !== null && pingResult.minLatencyMs !== undefined
            ? `${pingResult.minLatencyMs.toFixed(1)} ms`
            : "-");
        setText("resultAvg", pingResult.avgLatencyMs !== null && pingResult.avgLatencyMs !== undefined
            ? `${pingResult.avgLatencyMs.toFixed(1)} ms`
            : "-");
        setText("resultMax", pingResult.maxLatencyMs !== null && pingResult.maxLatencyMs !== undefined
            ? `${pingResult.maxLatencyMs.toFixed(1)} ms`
            : "-");

        const lossVal = pingResult.packetLoss !== null && pingResult.packetLoss !== undefined
            ? `${pingResult.packetLoss.toFixed(1)}%`
            : "-%";

        setText("statPacketLoss", lossVal);
        setText("statSent", pingResult.packetsSent ?? "-");
        setText("statReceived", pingResult.packetsReceived ?? "-");
        setText("statAvg", pingResult.avgLatencyMs !== null && pingResult.avgLatencyMs !== undefined
            ? `${pingResult.avgLatencyMs.toFixed(1)} ms`
            : "- ms");

        setText("rttMin", pingResult.minLatencyMs !== null && pingResult.minLatencyMs !== undefined
            ? `${pingResult.minLatencyMs.toFixed(1)} ms`
            : "- ms");
        setText("rttAvg", pingResult.avgLatencyMs !== null && pingResult.avgLatencyMs !== undefined
            ? `${pingResult.avgLatencyMs.toFixed(1)} ms`
            : "- ms");
        setText("rttMax", pingResult.maxLatencyMs !== null && pingResult.maxLatencyMs !== undefined
            ? `${pingResult.maxLatencyMs.toFixed(1)} ms`
            : "- ms");

        updateAllPingCharts();
    }

    async function fetchPingResult(host, count, status) {
        if (status) {
            status.classList.remove("d-none");
            status.classList.remove("alert-danger");
            status.classList.add("alert-info");
            setText("pingStatusText", `Melakukan ping ke ${host}...`);
        }

        const response = await fetch(`/api/ping?host=${encodeURIComponent(host)}&count=${count}`);
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.message || "Gagal menjalankan ping");
        }

        const pingResult = data.ping;
        pingHistoryData.push(pingResult);
        if (pingHistoryData.length > 20) {
            pingHistoryData.shift();
        }

        updatePingResultDisplay(pingResult, host);

        if (status) {
            status.classList.remove("alert-info");
            status.classList.add("alert-success");
            setText("pingStatusText", `✓ Ping berhasil ke ${host}`);
        }

        return pingResult;
    }

    async function startAutoPingMonitoring() {
        const hostInput = document.getElementById("pingHostInput");
        const countInput = document.getElementById("pingCountInput");
        const status = document.getElementById("pingStatus");

        if (!hostInput || !countInput || !status) {
            return;
        }

        const host = hostInput.value.trim() || "192.168.1.3";
        const count = parseInt(countInput.value, 10) || 4;

        if (pingIntervalId) {
            clearInterval(pingIntervalId);
        }

        try {
            await fetchPingResult(host, count, status);
        } catch (err) {
            console.error("Auto ping failed:", err.message);
            if (status) {
                status.classList.remove("alert-info");
                status.classList.add("alert-danger");
                setText("pingStatusText", `✗ Error: ${err.message}`);
            }
        }

        pingIntervalId = setInterval(async () => {
            try {
                await fetchPingResult(host, count, status);
            } catch (err) {
                console.error("Auto ping interval failed:", err.message);
            }
        }, 3000);
    }

    // Button setup untuk halaman ping khusus.
    function setupPingTestButtonNew() {
        const pingTestBtn = document.getElementById("pingTestBtn");
        if (!pingTestBtn) return;

        pingTestBtn.addEventListener("click", async () => {
            const hostInput = document.getElementById("pingHostInput");
            const countInput = document.getElementById("pingCountInput");
            const status = document.getElementById("pingStatus");
            const resultDiv = document.getElementById("pingResult");

            if (!hostInput || !countInput) return;

            const host = hostInput.value.trim() || "192.168.1.3";
            const count = parseInt(countInput.value) || 4;

            // Show loading state
            pingTestBtn.disabled = true;
            const originalText = pingTestBtn.innerText;
            pingTestBtn.innerHTML = '<span id="pingTestBtnText">Sedang menjalankan...</span>';
            status.classList.remove("d-none");
            status.classList.add("alert-info");
            document.getElementById("pingStatusText").innerText = `Melakukan ping ke ${host}...`;

            try {
                await fetchPingResult(host, count, status);
            } catch (err) {
                console.error("Ping test error:", err);
                status.classList.remove("alert-info");
                status.classList.add("alert-danger");
                setText("pingStatusText", `✗ Error: ${err.message}`);
            } finally {
                pingTestBtn.disabled = false;
                pingTestBtn.innerHTML = `<span id="pingTestBtnText">${originalText}</span>`;
                
                // Auto-hide status after 5 seconds
                setTimeout(() => {
                    if (status.classList.contains("alert-success")) {
                        status.classList.add("d-none");
                    }
                }, 5000);
            }
        });
    }

    // Jalankan monitoring ping otomatis setiap 2 detik.
    async function startPingLoop() {
        const input = document.getElementById("pingHost");
        const startButton = document.getElementById("runPingBtn");
        const stopButton = document.getElementById("stopPingBtn");
        const status = document.getElementById("pingStatus");

        if (!input || !startButton || !stopButton || !status) {
            return;
        }

        const host = input.value.trim() || "192.168.1.3";

        stopPingLoop();

        startButton.disabled = true;
        startButton.innerText = "Ping Running...";
        stopButton.disabled = false;
        status.innerText = `Mengukur ping ke ${host} setiap 2 detik...`;

        await runPingOnce(host, status);

        pingIntervalId = setInterval(() => {
            runPingOnce(host, status);
        }, 2000);
    }

    // Setup tombol ping utama pada dashboard.
    function setupPingTestButton() {
        const startButton = document.getElementById("runPingBtn");
        const stopButton = document.getElementById("stopPingBtn");

        if (!startButton || !stopButton) {
            // If old buttons not found, try new setup
            setupPingTestButtonNew();
            return;
        }

        startButton.addEventListener("click", startPingLoop);
        stopButton.addEventListener("click", stopPingLoop);
        stopButton.disabled = true;
    }

    // Motor Control Functions
    // Motor controller: kirim perintah `up`/`down` ke endpoint `/api/motor`.
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
    
    // Setup tombol motor di UI untuk menggerakkan servo ke atas/bawah.
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
    // Logout handler: panggil API logout lalu redirect ke halaman login.
    async function logout() {
        try {
            await fetch("/api/logout", { method: "POST" });
        } catch (err) {
            console.warn("Logout request failed:", err.message);
        } finally {
            window.location.href = "/login.html";
        }
    }

    // Load water status: ambil data air dari endpoint `/api/water`.
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

    // Render history servo: tampilkan riwayat pergerakan motor.
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

    // Render history air: tampilkan daftar riwayat level air yang terkini.
    function renderWaterHistory(items) {
        const historyBody = document.getElementById("waterHistoryBody");
        if (!historyBody) {
            return;
        }

        if (!items || items.length === 0) {
            historyBody.innerHTML = '<tr><td colspan="3" class="history-empty">Belum ada riwayat ketinggian air</td></tr>';
            return;
        }

        historyBody.innerHTML = items.map((item) => `
            <tr>
                <td>${formatHistoryTime(item.timestamp)}</td>
                <td>${escapeHtml(item.distance ?? item.level ?? "-")} cm</td>
                <td>${escapeHtml(item.status ?? "-")}</td>
            </tr>
        `).join("");
    }

    // Load history dari server dan render pada tabel-tabel dashboard.
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
                renderWaterHistory(data.history.water);
                renderQosHistory(data.history.qos);
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
    
    // Inisialisasi dashboard: cek sesi, muat partial, pasang event, dan mulai polling.
    async function initDashboard() {
        const isLoggedIn = await checkSession();
        if (!isLoggedIn) {
            return;
        }

        await loadDashboardPartials();
        setupPingTestButton();
        resetCharts();
        setupMotorControls();
        updateUI(emptyData);
        loadData();
        loadWaterData();
        loadQosData();
        loadHistory();
        setInterval(loadData, 3000);
        setInterval(loadWaterData, 1000);
        setInterval(loadQosData, 5000);
    }

    setupSidebar();
    updateDashboardClock();
    setInterval(updateDashboardClock, 1000);
    initDashboard();
});
