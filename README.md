# CPE210 Monitoring Dashboard

Aplikasi monitoring dashboard realtime untuk CPE210 dengan halaman login, sign up, proteksi dashboard, dan penyimpanan user ke MongoDB.

## Struktur Folder

```text
vscode-v6/
├── src/
│   └── server.js              # Backend Express, auth, MongoDB, API CPE210
├── public/
│   ├── index.html             # Dashboard utama
│   ├── login.html             # Halaman login dan sign up
│   ├── css/
│   │   └── style.css          # Styling aplikasi
│   └── js/
│       ├── script.js          # Logic dashboard
│       └── login.js           # Logic login/sign up
├── package.json               # Dependencies dan script npm
├── package-lock.json          # Lockfile npm
├── .gitignore
└── README.md
```

Catatan: file dashboard lama di root sudah dihapus supaya tidak ada penumpukan. Dashboard yang aktif adalah `public/index.html`.

## Cara Menjalankan

1. Install dependencies:

```bash
npm install
```

2. Pastikan MongoDB aktif di lokal:

```text
mongodb://127.0.0.1:27017
```

3. Jalankan server:

```bash
npm start
```

4. Buka aplikasi:

```text
http://localhost:3000
```

Aplikasi akan mengarahkan user ke halaman login sebelum masuk dashboard.

## Environment Opsional

Jika ingin mengganti konfigurasi default, gunakan environment variable berikut:

```text
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017
DB_NAME=zeno_dashboard
CPE_BASE_URL=https://192.168.1.3
CPE_USER=admin
CPE_PASS=admin
ESP32_BASE_URL=http://192.168.1.10
MOTOR_MOVE_DURATION_MS=40000
```

## Integrasi ESP32

Pada kode Arduino, arahkan `serverUrl` ke IP laptop yang menjalankan server:

```cpp
const char* serverUrl = "http://192.168.1.20:3000/data";
```

Server menerima data ultrasonik dari ESP32 melalui:

```text
POST /data
Body: { "jarak": 125.5 }
```

Kontrol motor dari dashboard diteruskan server ke ESP32:

```text
GET http://192.168.1.10/control?cmd=naik
GET http://192.168.1.10/control?cmd=turun
```

Jika IP ESP32 berubah, jalankan server dengan `ESP32_BASE_URL` yang sesuai.

## Akun Default

```text
admin / admin123
user / password123
```

User baru bisa dibuat melalui tab Sign Up. Data user disimpan di MongoDB collection `users`.

## Fitur

- Login dan sign up sebelum masuk dashboard
- Session cookie untuk proteksi dashboard dan API
- Dashboard realtime update setiap 3 detik
- Monitoring network, data rate, signal quality, dan channel CPE210
- Monitoring ketinggian air
- Kontrol motor stepper naik/turun
- Logout

## API Utama

```text
POST /api/signup
POST /api/login
GET  /api/me
POST /api/logout
GET  /api/cpe
POST /api/motor
GET  /api/motor/status
```

## Catatan Development

- Backend utama ada di `src/server.js`.
- Static frontend ada di folder `public/`.
- Jika MongoDB tidak aktif, login default masih bisa dipakai, tetapi Sign Up akan dinonaktifkan sampai MongoDB aktif.
