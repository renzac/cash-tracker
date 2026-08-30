const DB_KEY = 'ag-finance-data';
const DEVICE_KEY = 'ag-finance-device'; // Device-specific settings (session)

// --- SUPABASE CONFIGURATION ---
// User must update these values
const SUPABASE_URL = 'https://ptmvceklrmnimipvzovy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0bXZjZWtscm1uaW1pcHZ6b3Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1Mzc1MzMsImV4cCI6MjA4NjExMzUzM30.mjJyFHNO6LGmxIPr38-5j7uHeyF2uHaQsBwVqXmsDEs';
let supabaseClient = null;

if (SUPABASE_URL.trim() && SUPABASE_KEY.trim()) {
    if (window.supabase && window.supabase.createClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_KEY.trim());
    }
}

const Store = {
    data: {
        users: [
            { id: 1, username: 'Admin', password: 'Ren@007', role: 'admin', enabled: true },
            { id: 2, username: 'renju', password: 'renjuroshan', role: 'user', enabled: true }
        ],
        ledgerGroups: [
            { id: 1, name: 'Indirect Income', enabled: true },
            { id: 2, name: 'Indirect Expense', enabled: true },
            { id: 3, name: 'Investments', enabled: true },
            { id: 4, name: 'Temporary Cash', enabled: true }
        ],
        ledgers: [
            { id: 1, name: 'Groceries', groupId: 2, balance: 0, enabled: true },
            { id: 2, name: 'Fuel', groupId: 2, balance: 0, enabled: true },
            { id: 3, name: 'Rent', groupId: 2, balance: 0, enabled: true },
            { id: 4, name: 'Bakkala', groupId: 2, balance: 0, enabled: true }
        ],
        accounts: [
            { id: 1, name: 'KFH', balance: 500.000, enabled: true },
            { id: 2, name: 'NBK', balance: 1200.000, enabled: true },
            { id: 3, name: 'CBK', balance: 350.000, enabled: true },
            { id: 4, name: 'Cash in Hand', balance: 50.000, enabled: true }
        ],
        transactions: [],
        contraIn: [],
        expenses: [],
        categories: [],
        auth: {
            currentUser: null,
            rememberMe: false,
            biometricsEnabled: false
        },
        lastSync: null // Timestamp of last successful cloud save
    },

    // Session-only flags (not persisted)
    cloudLoaded: false, // True if we successfully fetched FROM cloud this session
    syncBlocked: false, // True if we failed to connect (blocks saving to avoid overwriting)

    async init() {
        if (supabaseClient) {
            // LOAD STATUS: 'SUCCESS' | 'EMPTY' | 'ERROR' codes
            const loadStatus = await this.loadFromCloud();

            if (loadStatus === 'SUCCESS' || loadStatus === 'EMPTY') {
                this.cloudLoaded = true;
                this.syncBlocked = false;
            } else {
                // If cloud load failed due to connection, BLOCK saving
                // We use local fallback ONLY for viewing, but we don't allow overwrite
                console.warn("Cloud connection failed. Entering Read-Only mode for safety.");
                this.syncBlocked = true;

                const localData = localStorage.getItem(DB_KEY);
                if (localData) {
                    this.data = { ...this.data, ...JSON.parse(localData) };
                }
            }
        } else {
            const savedData = localStorage.getItem(DB_KEY);
            if (savedData) {
                this.data = JSON.parse(savedData);
            }
        }

        // LOAD DEVICE-SPECIFIC AUTH (Always local)
        const deviceData = localStorage.getItem(DEVICE_KEY);
        if (deviceData) {
            this.data.auth = JSON.parse(deviceData);
        } else {
            // If no device data, ensure auth object exists with defaults
            if (!this.data.auth) {
                this.data.auth = { currentUser: null, rememberMe: false, biometricsEnabled: false };
            }
        }

        // --- ENSURE DEFAULTS & MIGRATIONS ---
        // Crucial for login: ensure users array exists
        if (!this.data.users || this.data.users.length === 0) {
            this.data.users = [
                { id: 1, username: 'Admin', password: 'Ren@007', role: 'admin', enabled: true },
                { id: 2, username: 'renju', password: 'renjuroshan', role: 'user', enabled: true }
            ];
        }

        if (!this.data.ledgerGroups) {
            this.data.ledgerGroups = [
                { id: 1, name: 'Indirect Income', enabled: true },
                { id: 2, name: 'Indirect Expense', enabled: true },
                { id: 3, name: 'Investments', enabled: true },
                { id: 4, name: 'Temporary Cash', enabled: true },
                { id: 5, name: 'Payables (Tithe/Zakat)', enabled: true }
            ];
        }

        // Ensure all accounts/ledgers have openingBalance
        if (this.data.accounts) {
            this.data.accounts.forEach(a => { if (a.openingBalance === undefined) a.openingBalance = 0; });
        }
        if (this.data.ledgers) {
            this.data.ledgers.forEach(l => {
                if (l.balance === undefined) l.balance = 0;
                if (l.openingBalance === undefined) l.openingBalance = 0;
            });
        }

        // --- NEW: LOAN PORTFOLIO DEFAULTS ---
        if (!this.data.loans) this.data.loans = [];
        if (!this.data.loanPayments) this.data.loanPayments = [];

        // Authoritative balance recalculation on startup
        if (!this.syncBlocked) {
            await this.recalculateBalances();
        } else {
            this.data.accounts.forEach(a => {
                a.openingBalance = this.round3(a.openingBalance || 0);
                let bal = a.openingBalance;
                this.data.transactions.forEach(tx => {
                    bal += this.getTransactionEffect(tx, 'account', a.id);
                });
                a.balance = this.round3(bal);
            });
            this.data.ledgers.forEach(l => {
                l.openingBalance = this.round3(l.openingBalance || 0);
                if (l.groupId > 2) {
                    let bal = l.openingBalance;
                    this.data.transactions.forEach(tx => {
                        bal += this.getTransactionEffect(tx, 'ledger', l.id);
                    });
                    l.balance = this.round3(bal);
                } else {
                    l.balance = 0;
                }
            });
        }
    },

    async save() {
        // Track when data was last modified locally
        this.data.lastModified = new Date().toISOString();

        // 1. Save device-local state (Auth)
        localStorage.setItem(DEVICE_KEY, JSON.stringify(this.data.auth));

        // 2. Save global data (Transactions, Ledgers, etc.)
        if (supabaseClient) {
            await this.saveToCloud();
        } else {
            // Create a copy of data excluding auth for local storage
            const localSaveData = { ...this.data };
            delete localSaveData.auth;
            localStorage.setItem(DB_KEY, JSON.stringify(localSaveData));
        }
    },

    async loadFromCloud() {
        console.log("Store: Attempting to load from cloud...");
        if (!supabaseClient) {
            console.warn("Store: Supabase client not initialized.");
            return 'CLIENT_MISSING';
        }
        try {
            const { data, error } = await supabaseClient.from('app_data').select('payload').eq('id', 'global_state').single();
            if (data) {
                // CRITICAL: Preserve local Auth object before overwriting data
                const currentAuth = this.data.auth || { currentUser: null, rememberMe: false, biometricsEnabled: false };

                this.data = data.payload;

                // Restore Auth immediately
                this.data.auth = currentAuth;

                console.log("Store: Cloud data loaded successfully.");
                return 'SUCCESS';
            } else if (error) {
                if (error.code === 'PGRST116') {
                    console.log("Store: Cloud database is empty (no data found).");
                    return 'EMPTY';
                }
                console.error("Store: Cloud load error:", error.message);
                return 'DB_ERROR: ' + error.message;
            }
            return 'UNKNOWN_ERROR';
        } catch (e) {
            console.error("Store: Critical Cloud connection failed:", e);
            // Return error but ensure it doesn't crash the specific call stack if possible
            return 'NETWORK_ERROR: ' + e.message;
        }
    },

    async checkConnection() {
        if (!supabaseClient) return false;
        try {
            const { error } = await supabaseClient.from('app_data').select('id').limit(1);
            return !error;
        } catch (e) {
            return false;
        }
    },

    async getLatestTimestamp() {
        if (!supabaseClient) return null;
        try {
            const { data, error } = await supabaseClient.from('app_data').select('payload->lastSync').eq('id', 'global_state').single();
            if (data && data.lastSync) return data.lastSync;
            return null;
        } catch (e) {
            return null;
        }
    },

    async ensureLatestData() {
        if (this.syncBlocked || !supabaseClient) return;
        try {
            const cloudTimeStr = await this.getLatestTimestamp();
            if (cloudTimeStr && this.data.lastSync) {
                const cloudDate = new Date(cloudTimeStr);
                const localDate = new Date(this.data.lastSync);
                if (cloudDate > localDate) {
                    console.log("Store: Newer data found in cloud. Syncing before mutation...");
                    const status = await this.loadFromCloud();
                    if (status !== 'SUCCESS' && status !== 'EMPTY') {
                        throw new Error("Could not fetch latest cloud data.");
                    }
                }
            }
        } catch (e) {
            console.error("ensureLatestData failed:", e);
            throw new Error("Sync failed. Please check connection.");
        }
    },

    async saveToCloud() {
        if (this.syncBlocked) {
            console.warn("Save blocked: No verified cloud connection this session.");
            return;
        }
        try {
            // Update last sync timestamp
            this.data.lastSync = new Date().toISOString();

            // EXCLUDE auth from cloud sync
            const cloudPayload = { ...this.data };
            delete cloudPayload.auth;

            const { error } = await supabaseClient.from('app_data').upsert({
                id: 'global_state',
                payload: cloudPayload
            });

            if (error) throw error;

            // Also save a local backup copy
            localStorage.setItem(DB_KEY, JSON.stringify(cloudPayload));
        } catch (e) {
            console.error("Cloud save failed:", e);
            // Don't set syncBlocked here, just log failure. 
            // The indicator will handle visual warning via checkConnection.
        }
    },

    // Transaction Logic
    async addTransaction(tx) {
        await this.ensureLatestData();
        tx.id = Date.now();
        this.data.transactions.unshift(tx);
        this._applyBalance(tx);
        await this.save();
        return tx;
    },

    async deleteTransaction(id) {
        await this.ensureLatestData();
        const tx = this.data.transactions.find(t => t.id === id);
        if (tx) {
            this._reverseBalance(tx);
            this.data.transactions = this.data.transactions.filter(t => t.id !== id);
            await this.save();
        }
    },

    async updateTransaction(id, updatedTx) {
        await this.ensureLatestData();
        const index = this.data.transactions.findIndex(t => t.id === id);
        if (index !== -1) {
            const oldTx = this.data.transactions[index];
            this._reverseBalance(oldTx);
            const newTx = { ...oldTx, ...updatedTx };
            this.data.transactions[index] = newTx;
            this._applyBalance(newTx);
            await this.save();
        }
    },

    round3(val) {
        return Math.round((parseFloat(val) || 0) * 1000) / 1000;
    },

    resolveEntityType(id, explicitType) {
        if (explicitType === 'account' || explicitType === 'ledger') return explicitType;
        const strId = String(id);
        const isAcc = this.data.accounts.some(a => String(a.id) === strId);
        const isLed = this.data.ledgers.some(l => String(l.id) === strId);
        if (isAcc && !isLed) return 'account';
        if (isLed && !isAcc) return 'ledger';
        // Disambiguate overlapping IDs (1-4): Standard expense ledgers (groupId <= 2)
        // never participate in contras or have rolling balances, so if groupId <= 2, it's an account.
        if (isLed) {
            const led = this.data.ledgers.find(l => String(l.id) === strId);
            if (led && led.groupId <= 2) return 'account';
        }
        return isAcc ? 'account' : 'ledger';
    },

    isPayableLedger(l) {
        if (!l) return false;
        if (l.groupId === 5) return true;
        const group = this.data.ledgerGroups ? this.data.ledgerGroups.find(g => g.id == l.groupId) : null;
        return group ? group.name.toLowerCase().includes('payable') : false;
    },

    getTransactionEffect(tx, entityType, entityId) {
        const amount = parseFloat(tx.amount) || 0;
        if (amount === 0) return 0;

        const targetId = String(entityId);
        const tFromId = String(tx.accountId);
        const tToId = String(tx.toId);
        const tLedId = String(tx.ledgerId);

        if (entityType === 'account') {
            if (tx.type === 'expense') {
                if (tFromId === targetId) return -amount;
            } else if (tx.type === 'income') {
                if (tFromId === targetId) return +amount;
            } else if (tx.type === 'contra') {
                const fromType = tx.fromType || this.resolveEntityType(tx.accountId);
                const toType = tx.toType || this.resolveEntityType(tx.toId);
                if (tFromId === targetId && fromType === 'account') return -amount;
                if (tToId === targetId && toType === 'account') return +amount;
            } else if (tx.type === 'passthrough') {
                const fromType = tx.fromType || this.resolveEntityType(tx.accountId);
                if (tFromId === targetId && fromType === 'account') return -amount;
            }
            return 0;
        }

        if (entityType === 'ledger') {
            const led = this.data.ledgers.find(l => String(l.id) === targetId);
            if (!led || led.groupId <= 2) return 0; // Standard non-rolling categories have no balance

            if (tx.type === 'expense') {
                if (tLedId === targetId) return +amount; // Outflow from cash is Inflow/Receivable to debt
            } else if (tx.type === 'income') {
                if (tLedId === targetId) return -amount; // Inflow to cash is debt settlement/reduction
            } else if (tx.type === 'contra') {
                const fromType = tx.fromType || this.resolveEntityType(tx.accountId);
                const toType = tx.toType || this.resolveEntityType(tx.toId);

                if (fromType === 'ledger' && toType === 'ledger') {
                    // Ledger-to-Ledger Contra: source gains balance (debt transferred out), destination loses
                    if (tFromId === targetId) return +amount;
                    if (tToId === targetId) return -amount;
                } else {
                    if (tFromId === targetId && fromType === 'ledger') return -amount; // Ledger paid to account
                    if (tToId === targetId && toType === 'ledger') return +amount; // Account paid into ledger
                }
            } else if (tx.type === 'passthrough') {
                const fromType = tx.fromType || this.resolveEntityType(tx.accountId);
                // In pass-through: Paid Via ledger decreases, Expense Ledger decreases
                if (tFromId === targetId && fromType === 'ledger') return -amount;
                if (tLedId === targetId) return -amount;
            }
            return 0;
        }

        return 0;
    },

    async recalculateBalances() {
        this.data.accounts.forEach(a => {
            a.openingBalance = this.round3(a.openingBalance || 0);
            let bal = a.openingBalance;
            this.data.transactions.forEach(tx => {
                bal += this.getTransactionEffect(tx, 'account', a.id);
            });
            a.balance = this.round3(bal);
        });

        this.data.ledgers.forEach(l => {
            l.openingBalance = this.round3(l.openingBalance || 0);
            if (l.groupId > 2) {
                let bal = l.openingBalance;
                this.data.transactions.forEach(tx => {
                    bal += this.getTransactionEffect(tx, 'ledger', l.id);
                });
                l.balance = this.round3(bal);
            } else {
                l.balance = 0;
            }
        });

        await this.save();
    },

    _applyBalance(tx) {
        this.data.accounts.forEach(a => {
            const effect = this.getTransactionEffect(tx, 'account', a.id);
            if (effect !== 0) a.balance = this.round3(a.balance + effect);
        });
        this.data.ledgers.forEach(l => {
            if (l.groupId > 2) {
                const effect = this.getTransactionEffect(tx, 'ledger', l.id);
                if (effect !== 0) l.balance = this.round3(l.balance + effect);
            }
        });
    },

    _reverseBalance(tx) {
        this.data.accounts.forEach(a => {
            const effect = this.getTransactionEffect(tx, 'account', a.id);
            if (effect !== 0) a.balance = this.round3(a.balance - effect);
        });
        this.data.ledgers.forEach(l => {
            if (l.groupId > 2) {
                const effect = this.getTransactionEffect(tx, 'ledger', l.id);
                if (effect !== 0) l.balance = this.round3(l.balance - effect);
            }
        });
    },

    async addLedgerGroup(name) {
        await this.ensureLatestData();
        const id = Date.now();
        this.data.ledgerGroups.push({ id, name, enabled: true });
        await this.save();
    },

    async deleteLedgerGroup(id) {
        await this.ensureLatestData();
        this.data.ledgerGroups = this.data.ledgerGroups.filter(g => g.id !== id);
        await this.save();
    },

    async updateLedgerGroup(id, name) {
        await this.ensureLatestData();
        const group = this.data.ledgerGroups.find(g => g.id === id);
        if (group) {
            group.name = name;
            await this.save();
        }
    },

    async addLedger(name, groupId, openingBalance = 0) {
        await this.ensureLatestData();
        const id = Date.now();
        const ob = parseFloat(openingBalance) || 0;
        this.data.ledgers.push({
            id, name, groupId: parseInt(groupId), openingBalance: ob, balance: ob, enabled: true
        });
        await this.save();
    },

    async updateLedger(id, name, groupId, openingBalance) {
        await this.ensureLatestData();
        const ledger = this.data.ledgers.find(l => l.id === id);
        if (ledger) {
            ledger.name = name;
            ledger.groupId = parseInt(groupId);
            if (openingBalance !== undefined) ledger.openingBalance = parseFloat(openingBalance) || 0;
            await this.recalculateBalances();
        }
    },

    async deleteLedger(id) {
        await this.ensureLatestData();
        this.data.ledgers = this.data.ledgers.filter(l => l.id !== id);
        await this.save();
    },

    async addAccount(name, openingBalance = 0) {
        await this.ensureLatestData();
        const id = Date.now();
        const ob = parseFloat(openingBalance) || 0;
        this.data.accounts.push({
            id, name, openingBalance: ob, balance: ob, enabled: true
        });
        await this.save();
    },

    async updateAccount(id, name, openingBalance) {
        await this.ensureLatestData();
        const acc = this.data.accounts.find(a => a.id === id);
        if (acc) {
            acc.name = name;
            if (openingBalance !== undefined) acc.openingBalance = parseFloat(openingBalance) || 0;
            await this.recalculateBalances();
        }
    },

    async toggleStatus(type, id) {
        await this.ensureLatestData();
        const item = this.data[type].find(i => i.id === id);
        if (item) {
            item.enabled = !item.enabled;
            await this.save();
        }
    },

    async updateUserPassword(id, newPass) {
        await this.ensureLatestData();
        const user = this.data.users.find(u => u.id === id);
        if (user) {
            user.password = newPass;
            await this.save();
        }
    },

    // --- LOAN PORTFOLIO METHODS ---
    async addLoan(loan) {
        await this.ensureLatestData();
        loan.id = crypto.randomUUID();
        if (!loan.created_at) loan.created_at = new Date().toISOString();
        if (loan.is_active === undefined) loan.is_active = true;
        if (loan.category === undefined) loan.category = 'personal';
        
        // Defaults for Personal category
        if (loan.category === 'personal') {
            if (loan.partner_share_pct === undefined) loan.partner_share_pct = 75;
            if (loan.my_share_pct === undefined) loan.my_share_pct = 25;
        } else {
            // Will Tec defaults (100% to lender)
            loan.partner_share_pct = 100;
            loan.my_share_pct = 0;
            loan.currency_code = 'KWD'; // Strict requirement
        }
        
        this.data.loans.push(loan);
        await this.save();
        return loan;
    },

    async updateLoan(id, updatedLoan) {
        await this.ensureLatestData();
        const index = this.data.loans.findIndex(l => l.id === id);
        if (index !== -1) {
            this.data.loans[index] = { ...this.data.loans[index], ...updatedLoan };
            await this.save();
        }
    },

    async deleteLoan(id) {
        await this.ensureLatestData();
        this.data.loans = this.data.loans.filter(l => l.id !== id);
        this.data.loanPayments = this.data.loanPayments.filter(p => p.loan_id !== id);
        await this.save();
    },

    async markLoanPaid(loanId, monthYear) {
        await this.ensureLatestData();
        // monthYear format: 'YYYY-MM'
        const existing = this.data.loanPayments.find(p => p.loan_id === loanId && p.month_year === monthYear);
        if (!existing) {
            this.data.loanPayments.push({
                loan_id: loanId,
                month_year: monthYear,
                status: 'YES',
                created_at: new Date().toISOString()
            });
            await this.save();
            return true;
        }
        return false;
    },

    async unmarkLoanPaid(loanId, monthYear) {
        await this.ensureLatestData();
        this.data.loanPayments = this.data.loanPayments.filter(p => !(p.loan_id === loanId && p.month_year === monthYear));
        await this.save();
    },
}
