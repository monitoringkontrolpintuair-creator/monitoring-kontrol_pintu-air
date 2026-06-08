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

    async function submitAuth({ formType, username, password, button, errorElement }) {
        button.disabled = true;
        const originalText = button.innerText;
        button.innerHTML = '<span class="loading"></span>';

        try {
            const response = await fetch(formType === "login" ? "/api/login" : "/api/signup", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                if (formType === "login") {
                    window.location.href = "/dashboard";
                    return;
                }

                signupForm.reset();
                loginForm.reset();
                loginUsername.value = username;
                showPanel("login", data.message || "Akun berhasil dibuat. Silakan login.");
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

        if (username.length < 3) {
            showMessage(signupErrorMessage, "Username minimal 3 karakter.");
            return;
        }

        if (password.length < 6) {
            showMessage(signupErrorMessage, "Password minimal 6 karakter.");
            return;
        }

        await submitAuth({
            formType: "signup",
            username,
            password,
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

    checkExistingSession();
});
