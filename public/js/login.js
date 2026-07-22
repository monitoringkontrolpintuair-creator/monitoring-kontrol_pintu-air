/*
    LOGIN.JS — Ringkasan perintah & fungsi

    Fungsi utama:
    - showMessage(element, message): tampilkan pesan error/sukses.
    - hideMessage(element): sembunyikan pesan.
    - showPanel(panelName, successText): toggle panel 'login'/'signup'.
    - checkExistingSession(): cek `/api/me`, redirect ke `/dashboard` jika sudah login.
    - submitAuth({ formType, username, password, button, errorElement }): kirim POST ke
            - `/api/login` untuk login
            - `/api/signup` untuk registrasi (memerlukan MongoDB aktif)

    Contoh curl (login):
        curl -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}'

    Catatan: file ini menangani event UI dan validasi minimum client-side.
*/

document.addEventListener("DOMContentLoaded", function() {
    const loginPanel = document.getElementById("loginPanel");
    const signupPanel = document.getElementById("signupPanel");
    const loginForm = document.getElementById("loginForm");
    const signupForm = document.getElementById("signupForm");
    const loginBtn = document.getElementById("loginBtn");
    const signupBtn = document.getElementById("signupBtn");
    const showSignupBtn = document.getElementById("showSignupBtn");
    const showLoginBtn = document.getElementById("showLoginBtn");
    const loginErrorMessage = document.getElementById("loginErrorMessage");
    const loginSuccessMessage = document.getElementById("loginSuccessMessage");
    const signupErrorMessage = document.getElementById("signupErrorMessage");
    const loginUsername = document.getElementById("loginUsername");
    const loginPassword = document.getElementById("loginPassword");
    const signupUsername = document.getElementById("signupUsername");
    const signupPassword = document.getElementById("signupPassword");
    const signupEmail = document.getElementById("signupEmail");
    // Verification modal elements
    const verificationModal = document.getElementById("verificationModal");
    const verificationIdentifier = document.getElementById("verificationIdentifier");
    const verificationCodeInput = document.getElementById("verificationCode");
    const verifyCodeBtn = document.getElementById("verifyCodeBtn");
    const resendCodeBtn = document.getElementById("resendCodeBtn");
    const verificationMessage = document.getElementById("verificationMessage");
    const closeVerificationBtn = document.getElementById("closeVerificationBtn");

    function showMessage(element, message) {
        element.innerText = message;
        element.style.display = "block";
    }

    function hideMessage(element) {
        element.style.display = "none";
        element.innerText = "";
    }

    function clearLoginMessages() {
        hideMessage(loginErrorMessage);
        hideMessage(loginSuccessMessage);
    }

    function clearSignupMessages() {
        hideMessage(signupErrorMessage);
    }

    function showPanel(panelName, successText = "") {
        const showLogin = panelName === "login";

        loginPanel.classList.toggle("active", showLogin);
        signupPanel.classList.toggle("active", !showLogin);

        clearLoginMessages();
        clearSignupMessages();

        if (successText) {
            showMessage(loginSuccessMessage, successText);
        }

        if (showLogin) {
            loginUsername.focus();
        } else {
            signupUsername.focus();
        }
    }

    async function checkExistingSession() {
        try {
            const response = await fetch("/api/me");
            if (response.ok) {
                window.location.href = "/dashboard";
            }
        } catch (error) {
            console.warn("Session check skipped:", error.message);
        }
    }

    async function submitAuth({ formType, username, password, email, button, errorElement }) {
        button.disabled = true;
        const originalText = button.innerText;
        button.innerHTML = '<span class="loading"></span>';

        try {
            const endpoint = formType === "login" ? "/api/login" : "/api/signup";
            const body = formType === "login" ? { username, password } : { username, password, email };

            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            });

            const data = await response.json();

            if (response.ok && data.success) {
                if (formType === "login") {
                    window.location.href = "/dashboard";
                    return;
                }

                // Signup successful: show verification modal so user can enter OTP
                signupForm.reset();
                loginForm.reset();
                loginUsername.value = username || "";
                const identifier = email || username;
                openVerificationModal(identifier, data.message || "Akun dibuat. Masukkan kode verifikasi.", "signup");
                return;
            }

            // If server returns 403 (email not verified), open verification modal
            if (response.status === 403 && /verifik/i.test(data.message || "")) {
                const identifier = (arguments[0] && (arguments[0].email || arguments[0].username)) || username;
                openVerificationModal(identifier, data.message || "Email belum terverifikasi. Masukkan kode OTP.", "signup");
                return;
            }

            showMessage(errorElement, data.message || "Proses gagal. Coba lagi.");
        } catch (error) {
            console.error("Auth error:", error);
            showMessage(errorElement, "Terjadi kesalahan koneksi. Coba lagi.");
        } finally {
            button.disabled = false;
            button.innerText = originalText;
        }
    }

    showSignupBtn.addEventListener("click", () => showPanel("signup"));
    showLoginBtn.addEventListener("click", () => showPanel("login"));

    loginForm.addEventListener("submit", async function(e) {
        e.preventDefault();
        clearLoginMessages();
        const username = loginUsername.value.trim();
        const password = loginPassword.value;

        if (username.length < 3) {
            showMessage(loginErrorMessage, "Username minimal 3 karakter.");
            return;
        }

        if (password.length < 6) {
            showMessage(loginErrorMessage, "Password minimal 6 karakter.");
            return;
        }

        await submitAuth({
            formType: "login",
            username,
            password,
            button: loginBtn,
            errorElement: loginErrorMessage
        });
    });

    signupForm.addEventListener("submit", async function(e) {
        e.preventDefault();
        clearSignupMessages();

        const username = signupUsername.value.trim();
        const password = signupPassword.value;
        const email = signupEmail.value.trim().toLowerCase();

        if (username.length < 3) {
            showMessage(signupErrorMessage, "Username minimal 3 karakter.");
            return;
        }

        if (password.length < 6) {
            showMessage(signupErrorMessage, "Password minimal 6 karakter.");
            return;
        }

        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            showMessage(signupErrorMessage, "Email tidak valid.");
            return;
        }

        await submitAuth({
            formType: "signup",
            username,
            password,
            email,
            button: signupBtn,
            errorElement: signupErrorMessage
        });
    });

    [loginUsername, loginPassword].forEach((input) => {
        input.addEventListener("input", clearLoginMessages);
    });

    [signupUsername, signupPassword].forEach((input) => {
        input.addEventListener("input", clearSignupMessages);
    });
    signupEmail.addEventListener("input", clearSignupMessages);

    // Verification modal helpers
    function openVerificationModal(identifier, infoMessage = "", mode = "signup") {
        verificationIdentifier.value = identifier || "";
        verificationCodeInput.value = "";
        showVerificationMessage(infoMessage, false);
        verificationModal.style.display = "flex";
        verificationCodeInput.focus();
    }

    function closeVerificationModal() {
        verificationModal.style.display = "none";
        showVerificationMessage("");
    }

    function showVerificationMessage(msg, isError = true) {
        if (!verificationMessage) return;
        verificationMessage.style.display = msg ? "block" : "none";
        verificationMessage.innerText = msg || "";
        verificationMessage.style.color = isError ? "#b00020" : "#0b6623";
    }

    async function verifyCode() {
        const identifier = verificationIdentifier.value.trim();
        const code = verificationCodeInput.value.trim();
        if (!identifier || !code) {
            showVerificationMessage("Username/email dan kode diperlukan.");
            return;
        }

        verifyCodeBtn.disabled = true;
        const payload = { email: identifier, code };

        try {
            const res = await fetch("/api/verify-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const d = await res.json();
            if (res.ok && d.success) {
                showVerificationMessage(d.message || "Email terverifikasi.", false);
                setTimeout(() => {
                    closeVerificationModal();
                    if (d.redirect) {
                        window.location.href = "/dashboard";
                    } else {
                        showPanel("login", d.message || "Email berhasil diverifikasi. Silakan login.");
                    }
                }, 900);
                return;
            }

            showVerificationMessage(d.message || "Verifikasi gagal.");
        } catch (err) {
            console.error("verifyCode error:", err);
            showVerificationMessage("Gagal menghubungi server.");
        } finally {
            verifyCodeBtn.disabled = false;
        }
    }

    async function resendCode() {
        const identifier = verificationIdentifier.value.trim();
        if (!identifier) {
            showVerificationMessage("Identifier tidak ditemukan.");
            return;
        }

        resendCodeBtn.disabled = true;
        const payload = identifier.includes("@") ? { email: identifier } : { username: identifier };

        try {
            const res = await fetch("/api/resend-verification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const d = await res.json();
            if (res.ok && d.success) {
                showVerificationMessage(d.message || "Kode verifikasi dikirim ulang.", false);
                return;
            }

            showVerificationMessage(d.message || "Gagal kirim ulang kode.");
        } catch (err) {
            console.error("resendCode error:", err);
            showVerificationMessage("Gagal menghubungi server.");
        } finally {
            resendCodeBtn.disabled = false;
        }
    }

    verifyCodeBtn.addEventListener("click", verifyCode);
    resendCodeBtn.addEventListener("click", resendCode);
    closeVerificationBtn.addEventListener("click", closeVerificationModal);

    checkExistingSession();
});
