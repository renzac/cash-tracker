const DB_KEY = 'ag-finance-data';
const DEVICE_KEY = 'ag-finance-device'; // Device-specific settings (session)

// --- SUPABASE CONFIGURATION ---
// User must update these values
const SUPABASE_URL = 'https://ptmvceklrmnimipvzovy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0bXZjZWtscm1uaW1pcHZ6b3Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1Mzc1MzMsImV4cCI6MjA4NjExMzUzM30.mjJyFHNO6LGmxIPr38-5j7uHeyF2uHaQsBwVqXmsDEs';
let supabaseClient = null;

if (SUPABASE_URL.trim() && SUPABASE_KEY.trim()) {
    // window.supabase is provided by the CDN script
    if (window.supabase && window.supabase.createClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_KEY.trim());
    } else {
        console.warn("Supabase library not yet loaded or failed.");
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
        auth: {
            currentUser: null,
            rememberMe: false,
            biometricsEnabled: false
        }
    },

    async init() {
        if (supabaseClient) {
            // Attempt to load from cloud. If successful, this.data will be populated.
            // If not, this.data will remain its initial state (or empty if no initial data).
            const hasCloudData = await this.loadFromCloud();
            if (!hasCloudData) {
                // If cloud load failed or no data, check local storage for migration
                const localData = localStorage.getItem(DB_KEY);
                if (localData) {
                    console.log("Supabase active but cloud empty or failed. Migrating local data...");
                    // Parse local data, but ensure 'auth' is not overwritten if it was already loaded from deviceData
                    const parsedLocalData = JSON.parse(localData);
                    this.data = { ...this.data, ...parsedLocalData }; // Merge, keeping initial auth if not in localData
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

        // If we migrated or seeded, save to cloud
        await this.save();
    },

    async save() {
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
        if (!supabaseClient) return false;
        try {
            const { data, error } = await supabaseClient.from('app_data').select('payload').eq('id', 'global_state').single();
            if (data) {
                this.data = data.payload;
                console.log("Cloud data loaded successfully.");
                return true;
            } else if (error) {
                if (error.code === 'PGRST116') {
                    console.log("Cloud database is empty (no data found).");
                    return false;
                }
                if (error.code === '42P01') {
                    console.error("Supabase table 'app_data' not found. Please run the SQL script.");
                    setTimeout(() => Auth.showToast("Cloud table missing! Run the SQL script in Supabase.", "error"), 2000);
                } else {
                    console.error("Cloud load error:", error.message);
                }
                return false;
            }
            return false;
        } catch (e) {
            console.error("Cloud connection failed:", e);
            return false;
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

    async saveToCloud() {
        try {
            // EXCLUDE auth from cloud sync to avoid device session leaks
            const cloudPayload = { ...this.data };
            delete cloudPayload.auth;

            await supabaseClient.from('app_data').upsert({ id: 'global_state', payload: cloudPayload });
        } catch (e) {
            console.error("Cloud save failed:", e);
        }
    },

    // Transaction Logic
    async addTransaction(tx) {
        tx.id = Date.now();
        this.data.transactions.unshift(tx);
        this._applyBalance(tx);
        await this.save();
        return tx;
    },

    async deleteTransaction(id) {
        const tx = this.data.transactions.find(t => t.id === id);
        if (tx) {
            this._reverseBalance(tx);
            this.data.transactions = this.data.transactions.filter(t => t.id !== id);
            await this.save();
        }
    },

    async updateTransaction(id, updatedTx) {
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

    async recalculateBalances() {
        this.data.accounts.forEach(a => { a.balance = a.openingBalance || 0; });
        this.data.ledgers.forEach(l => {
            if (l.groupId > 2) l.balance = l.openingBalance || 0;
        });

        const sortedTxs = [...this.data.transactions].sort((a, b) => a.id - b.id);
        sortedTxs.forEach(tx => {
            const acc = this.data.accounts.find(a => a.id == tx.accountId);
            const led = this.data.ledgers.find(l => l.id == tx.ledgerId);

            if (tx.type === 'expense') {
                if (acc) acc.balance -= tx.amount;
                if (led && led.groupId > 2) led.balance += tx.amount;
            } else if (tx.type === 'income') {
                if (acc) acc.balance += tx.amount;
                if (led && led.groupId > 2) led.balance -= tx.amount;
            } else if (tx.type === 'contra') {
                const fromLed = this.data.ledgers.find(l => l.id == tx.accountId);
                const toLed = this.data.ledgers.find(l => l.id == tx.toId);
                const fromAcc = this.data.accounts.find(a => a.id == tx.accountId);
                const toAcc = this.data.accounts.find(a => a.id == tx.toId);

                if (fromLed && fromLed.groupId > 2) fromLed.balance -= tx.amount;
                if (toLed && toLed.groupId > 2) toLed.balance += tx.amount;
                if (fromAcc) fromAcc.balance -= tx.amount;
                if (toAcc) toAcc.balance += tx.amount;
            }
        });
        await this.save();
    },

    _applyBalance(tx) {
        if (tx.type === 'expense') {
            const acc = this.data.accounts.find(a => a.id == tx.accountId);
            if (acc) acc.balance -= tx.amount;
            const led = this.data.ledgers.find(l => l.id == tx.ledgerId);
            if (led && led.groupId > 2) led.balance += tx.amount;
        } else if (tx.type === 'income') {
            const acc = this.data.accounts.find(a => a.id == tx.accountId);
            if (acc) acc.balance += tx.amount;
            const led = this.data.ledgers.find(l => l.id == tx.ledgerId);
            if (led && led.groupId > 2) led.balance -= tx.amount;
        } else if (tx.type === 'contra') {
            const from = this.data.accounts.find(a => a.id == tx.accountId) || this.data.ledgers.find(l => l.id == tx.accountId);
            const to = this.data.accounts.find(a => a.id == tx.toId) || this.data.ledgers.find(l => l.id == tx.toId);

            if (from) {
                if (from.groupId === undefined || from.groupId > 2) from.balance -= tx.amount;
            }
            if (to) {
                if (to.groupId === undefined || to.groupId > 2) to.balance += tx.amount;
            }
        }
    },

    _reverseBalance(tx) {
        if (tx.type === 'expense') {
            const acc = this.data.accounts.find(a => a.id == tx.accountId);
            if (acc) acc.balance += tx.amount;
            const led = this.data.ledgers.find(l => l.id == tx.ledgerId);
            if (led && led.groupId > 2) led.balance -= tx.amount;
        } else if (tx.type === 'income') {
            const acc = this.data.accounts.find(a => a.id == tx.accountId);
            if (acc) acc.balance -= tx.amount;
            const led = this.data.ledgers.find(l => l.id == tx.ledgerId);
            if (led && led.groupId > 2) led.balance += tx.amount;
        } else if (tx.type === 'contra') {
            const from = this.data.accounts.find(a => a.id == tx.accountId) || this.data.ledgers.find(l => l.id == tx.accountId);
            const to = this.data.accounts.find(a => a.id == tx.toId) || this.data.ledgers.find(l => l.id == tx.toId);

            if (from) {
                if (from.groupId === undefined || from.groupId > 2) from.balance += tx.amount;
            }
            if (to) {
                if (to.groupId === undefined || to.groupId > 2) to.balance -= tx.amount;
            }
        }
    },

    async addLedgerGroup(name) {
        const id = Date.now();
        this.data.ledgerGroups.push({ id, name, enabled: true });
        await this.save();
    },

    async deleteLedgerGroup(id) {
        this.data.ledgerGroups = this.data.ledgerGroups.filter(g => g.id !== id);
        await this.save();
    },

    async updateLedgerGroup(id, name) {
        const group = this.data.ledgerGroups.find(g => g.id === id);
        if (group) {
            group.name = name;
            await this.save();
        }
    },

    async addLedger(name, groupId, openingBalance = 0) {
        const id = Date.now();
        const ob = parseFloat(openingBalance) || 0;
        this.data.ledgers.push({
            id, name, groupId: parseInt(groupId), openingBalance: ob, balance: ob, enabled: true
        });
        await this.save();
    },

    async updateLedger(id, name, groupId, openingBalance) {
        const ledger = this.data.ledgers.find(l => l.id === id);
        if (ledger) {
            ledger.name = name;
            ledger.groupId = parseInt(groupId);
            if (openingBalance !== undefined) ledger.openingBalance = parseFloat(openingBalance) || 0;
            await this.recalculateBalances();
        }
    },

    async deleteLedger(id) {
        this.data.ledgers = this.data.ledgers.filter(l => l.id !== id);
        await this.save();
    },

    async addAccount(name, openingBalance = 0) {
        const id = Date.now();
        const ob = parseFloat(openingBalance) || 0;
        this.data.accounts.push({
            id, name, openingBalance: ob, balance: ob, enabled: true
        });
        await this.save();
    },

    async updateAccount(id, name, openingBalance) {
        const acc = this.data.accounts.find(a => a.id === id);
        if (acc) {
            acc.name = name;
            if (openingBalance !== undefined) acc.openingBalance = parseFloat(openingBalance) || 0;
            await this.recalculateBalances();
        }
    },

    async toggleStatus(type, id) {
        const item = this.data[type].find(i => i.id === id);
        if (item) {
            item.enabled = !item.enabled;
            await this.save();
        }
    },

    async updateUserPassword(id, newPass) {
        const user = this.data.users.find(u => u.id === id);
        if (user) {
            user.password = newPass;
            await this.save();
        }
    }
};
