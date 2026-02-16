const Auth = {
    loginOverlay: document.getElementById('login-overlay'),
    loginForm: document.getElementById('login-form'),
    appContent: document.getElementById('app-content'),
    usernameInput: document.getElementById('username'),
    passwordInput: document.getElementById('password'),
    rememberMeCheckbox: document.getElementById('remember-me'),
    biometricArea: document.getElementById('biometric-login-area'),
    biometricBtn: document.getElementById('biometric-login-btn'),
    adminNav: document.getElementById('admin-nav'),

    async init() {
        console.log("Auth: Initializing...");
        if (this.loginForm) {
            this.loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                console.log("Auth: Login form submitted");
                await this.handleManualLogin();
            });
        } else {
            console.error("Auth: Login form not found!");
            alert("Critical Error: Login form missing.");
        }

        document.getElementById('logout-btn').addEventListener('click', () => this.logout());

        // Wait for Store to initialize
        await Store.init();

        // Check for persistent session
        if (Store.data.auth.currentUser && Store.data.auth.rememberMe) {
            await this.enterApp(Store.data.auth.currentUser);
        }

        // Check for biometrics availability
        if (Store.data.auth.biometricsEnabled) {
            this.biometricArea.classList.remove('hidden');
        }
    },

    async handleManualLogin() {
        console.log("Auth: Handling manual login...");
        try {
            const user = Store.data.users.find(u =>
                u.username.toLowerCase() === this.usernameInput.value.toLowerCase() &&
                u.password === this.passwordInput.value
            );

            if (user) {
                console.log("Auth: Credentials valid for", user.username);
                if (!user.enabled) {
                    this.showError("Account disabled by Admin.");
                    return;
                }

                // Update State
                // FAIL-SAFE: Ensure auth object exists
                if (!Store.data.auth) {
                    Store.data.auth = { currentUser: null, rememberMe: false, biometricsEnabled: false };
                }

                Store.data.auth.currentUser = user;
                Store.data.auth.rememberMe = this.rememberMeCheckbox.checked;

                // OPTIMIZATION: Save only local Auth data. 
                // Do NOT call Store.save() here as it triggers full Cloud Sync which might hang.
                console.log("Auth: Saving session locally...");
                localStorage.setItem('ag-finance-device', JSON.stringify(Store.data.auth));

                console.log("Auth: Entering app...");
                await this.enterApp(user);
                this.showToast("Welcome back, " + user.username);
            } else {
                console.warn("Auth: Invalid credentials");
                this.showError("Invalid credentials");
                this.loginForm.classList.add('animate-shake');
                setTimeout(() => this.loginForm.classList.remove('animate-shake'), 400);
            }
        } catch (e) {
            console.error("Auth: Manual Login Error:", e);
            alert("Login System Error: " + e.message);
        }
    },

    async enterApp(user) {
        console.log("Auth: Entering app for user:", user.username);
        try {
            this.loginOverlay.style.display = 'none';
            this.appContent.classList.remove('hidden');

            if (user.role === 'admin') {
                this.adminNav.classList.remove('hidden');
            }

            // Retry logic for AppLogic
            let attempts = 0;
            const maxAttempts = 10;

            const findAppLogic = () => {
                if (typeof AppLogic !== 'undefined') return AppLogic;
                if (window.AppLogic) return window.AppLogic;
                return null;
            };

            let app = findAppLogic();
            while (!app && attempts < maxAttempts) {
                console.log(`Auth: AppLogic not found, retrying (${attempts + 1}/${maxAttempts})...`);
                await new Promise(r => setTimeout(r, 200)); // Wait 200ms
                app = findAppLogic();
                attempts++;
            }

            if (app) {
                console.log("Auth: AppLogic found, initializing...");
                await app.init();
                console.log("Auth: AppLogic initialized successfully.");
            } else {
                console.error("Auth: AppLogic not found after retries!");
                throw new Error("Core logic failed to load. Please refresh.");
            }
        } catch (e) {
            console.error("Auth: Login Fatal Error:", e);
            this.showError("Login failed: " + e.message);
            // Show overlay again so they aren't stuck
            this.loginOverlay.style.display = 'flex';
            this.appContent.classList.add('hidden');
        }
    },

    async logout() {
        Store.data.auth.currentUser = null;
        Store.data.auth.rememberMe = false;
        await Store.save();
        location.reload();
    },

    showError(msg) {
        this.showToast(msg, 'error');
    },

    showToast(msg, type = 'success') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `px-6 py-3 rounded-2xl shadow-2xl text-slate-950 font-bold animate-fade-in ${type === 'success' ? 'bg-emerald-400' : 'bg-rose-500'}`;
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
};

// Expose Auth for debugging
window.Auth = Auth;

// Wait for DOM to be ready before initializing
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Ready. Initializing Auth...");
    Auth.init();
});
