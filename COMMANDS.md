# Ringkasan Fungsi & Perintah

Panduan singkat fungsi utama dan perintah untuk menjalankan proyek.

**Jalankan aplikasi**
- **Install dependencies:** jalankan `npm install` di folder proyek.
- **Start server:** `npm start` atau `npm run dev` (menjalankan `node src/server.js`).

**Variabel lingkungan penting**
- **PORT:** port server (default 3000)
- **MONGO_URI:** URI MongoDB (default mongodb://127.0.0.1:27017)
- **DB_NAME:** nama database Mongo (default zeno_dashboard)
- **CPE_BASE_URL, CPE_USER, CPE_PASS, CPE_COOKIE:** konfigurasi akses CPE210
- **ESP32_BASE_URL:** alamat ESP32 untuk endpoint `/data`

**Server utama**: [src/server.js](src/server.js)
- `hashPassword(password)`: buat hash SHA-256 untuk password.
- `getCookie(req, name)`: ambil cookie dari header request.
- `setSessionCookie(res, sessionId)`: set cookie `sessionId` di response.
- `clearSessionCookie(res)`: hapus cookie `sessionId`.
- `getSession(req)`: ambil session dari cookie dan validasi umur.
- `requireAuth(req,res,next)`: middleware melindungi route yang butuh login.
- `addHistoryEvent(type, event)`: tambah event ke history (`servo`, `antenna`, `water`).
- `recordWaterHistory(distance, status)`: rekam snapshot level air dan kondisi perubahan.
- `getAntennaSnapshot(data)`: normalisasi data antenna dari CPE.
- `parsePingOutput(output)`: parse hasil `ping` (cross-platform) menjadi objek statistik.
- `addPingHistory(result)`: simpan ringkasan hasil ping ke memori untuk grafik.
- `saveAntennaDataToMongo(data)`: simpan data antenna ke koleksi MongoDB jika tersedia.
- `recordAntennaHistory(data)`: rekam history perubahan antenna.
- `connectMongo()`: koneksi ke MongoDB, inisialisasi koleksi dan index.
- `ensureDefaultUsers()`: pastikan user default (`admin`, `user`) ada.
- `findUser(username)`: cari user di MongoDB atau fallback ke `fallbackUsers`.
- `verifyPassword(user, password)`: verifikasi password (mendukung hash dan legacy plain-text).
- `getWaterStatus(distance)`: konversi jarak sensor menjadi status `Tinggi/Normal/Rendah`.
- `runPingTest(host, count)`: jalankan perintah `ping` OS dan parse hasilnya.
- `loginToCPE()`, `getCpePasswordEncoder()`, `getDataFromCPE()`, `getDataFromCPEWithLogin()`: fungsi untuk login/ambil data dari perangkat CPE210 (menggunakan axios + cookie jar).
- `getCpeRequestConfig()`: header default untuk request ke CPE (menambahkan cookie bila di-override).
- `normalizeCpeData()`, `isCpeInfoData()`: utilitas untuk memvalidasi/normalisasi respons CPE.
- `generateSessionId()`: buat session ID acak.
- `startApp()`: inisialisasi (koneksi MongoDB opsional) dan mulai server.

Endpoints utama (pada server):
- `GET /` atau `GET /index.html`: halaman utama.
- `GET /login` dan `GET /login.html`: halaman login.
- `GET /dashboard` (dilatih oleh `requireAuth`): dashboard utama.
- `POST /api/signup`: registrasi user (memerlukan MongoDB aktif).
- `POST /api/login`: login, set cookie sesi.
- `GET /api/me`: cek sesi saat ini.
- `POST /api/logout`: logout (hapus sesi).
- `POST /data`: endpoint ESP32 mengirimkan field `jarak` (cm).
- `GET /data`: info singkat untuk ESP32 endpoint.
- `GET /api/water`: status air (dilindungi oleh auth).
- `GET /api/ping?host=...&count=...`: jalankan ping dari server.
- `GET /api/ping-history`: dapatkan history ping saat ini.
- `GET /api/cpe`: ambil data dari CPE210 (melakukan login jika perlu).
- `POST /api/motor`: kontrol motor/servo, body `{ direction: "up"|"down" }`.
- `GET /api/motor/status`: status motor saat ini.
- `GET /api/history`: history pergerakan servo, antenna, dan water.

**Client (frontend)**

File login: [public/js/login.js](public/js/login.js)
- `showMessage(element, message)`: tampilkan pesan error/sukses.
- `hideMessage(element)`: sembunyikan pesan.
- `showPanel(panelName, successText)`: toggle antara panel login/signup.
- `checkExistingSession()`: cek `/api/me` dan redirect bila sudah login.
- `submitAuth({ formType, username, password, ... })`: kirim request ke `/api/login` atau `/api/signup`.
- Event handlers untuk form login/signup dan tombol toggle.

File dashboard/script: [public/js/script.js](public/js/script.js)
- `setSidebarExpanded(isExpanded)`, `setupSidebar()`: kontrol sidebar responsif.
- `updateDashboardClock()`: update jam di UI.
- `setDashboardDataStatus(statusText)`, `setLastRefreshTime()`: update indikator status.
- `drawLineChart(canvasId, labels, datasets)`: renderer canvas chart sederhana (custom).
- `updateSignalTrend(data)`, `updatePingChart(result)`: update data chart dan history.
- `loadDashboardPartials()`: lazy-load partial HTML (partials folder).
- `checkSession()`: validasi sesi, redirect jika tidak login.
- `updateUI(data)`: isi UI dengan data dari `/api/cpe`.
- `updateWaterLevel(water)`: update tampilan level air dan progress bar.
- `loadData()`: fetch `/api/cpe` dan proses data.
- `runPingOnce(host, statusElement)`, `startPingLoop()`, `stopPingLoop()`: fitur ping dari UI ke server.
- `renderLatencyTrendChart()`, `renderPacketComparisonChart()`, `renderPacketLossChart()`, `renderPingHistoryTable()`: charting menggunakan Chart.js (dibuat dari data pingHistoryData).
- `setupPingTestButton()` dan `setupPingTestButtonNew()`: handler tombol ping pada halaman ping.html.
- `controlMotor(direction)`: kirim `POST /api/motor` untuk menggerakkan servo.
- `setupMotorControls()`: attach event ke tombol motor.
- `logout()`: panggil `/api/logout` dan redirect ke login.
- `loadWaterData()`, `loadHistory()`, plus renderer history untuk servo/antenna/water.
- `initDashboard()`: inisialisasi saat halaman dimuat (cek sesi, load partials, set intervals).

**Important notes / tips**
- Jika menggunakan signup, pastikan MongoDB aktif; tanpa MongoDB signup dinonaktifkan, tetapi login default tetap bekerja (credentials yang dicetak saat start).
- Untuk debug CPE210, atur `CPE_BASE_URL`, `CPE_USER`, `CPE_PASS` di environment.
- ESP32 harus POST ke `/data` dengan body `{ jarak: <number> }`.

Jika mau, saya bisa:
- Menambahkan komentar inline pada setiap fungsi di file sumber secara otomatis.
- Memasukkan contoh curl untuk tiap endpoint.

Mau saya tambahkan komentar inline ke file sumber sekarang?