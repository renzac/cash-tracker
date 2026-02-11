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
        this.loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleManualLogin();
        });

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
        const user = Store.data.users.find(u =>
            u.username.toLowerCase() === this.usernameInput.value.toLowerCase() &&
            u.password === this.passwordInput.value
        );

        if (user) {
            if (!user.enabled) {
                this.showError("Account disabled by Admin.");
                return;
            }
            Store.data.auth.currentUser = user;
            Store.data.auth.rememberMe = this.rememberMeCheckbox.checked;
            await Store.save();
            await this.enterApp(user);
            this.showToast("Welcome back, " + user.username);
        } else {
            this.showError("Invalid credentials");
            this.loginForm.classList.add('animate-shake');
            setTimeout(() => this.loginForm.classList.remove('animate-shake'), 400);
        }
    },

    async enterApp(user) {
        this.loginOverlay.style.display = 'none';
        this.appContent.classList.remove('hidden');

        if (user.role === 'admin') {
            this.adminNav.classList.remove('hidden');
        }

        // Initialize App Logic
        if (window.AppLogic) await window.AppLogic.init();
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

Auth.init();
