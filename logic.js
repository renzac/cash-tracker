const AppLogic = {
    currentView: 'transactions',
    viewTitle: document.getElementById('current-view-title'),
    displayDate: document.getElementById('display-date'),
    modalContainer: document.getElementById('modal-container'),
    loanCategoryFilter: 'personal',
    loanFilterStatus: 'active',
    loanSortCriteria: 'priority',
    willTecViewMode: 'list',

    async init() {
        // Auto-recalculate on startup to fix any legacy sign issues
        await Store.recalculateBalances();

        this.updateClock();
        setInterval(() => this.updateClock(), 60000);
        this.setupNavigation();
        await this.setupForms(); // Now async
        await this.renderAll();
        this.updateConnectionStatus();

        // Setup periodic sync check (every 2 minutes)
        setInterval(() => this.checkForUpdates(), 120000);

        // Make sync indicator clickable for manual refresh
        const syncArea = document.getElementById('sync-status')?.parentElement;
        if (syncArea) {
            syncArea.style.cursor = 'pointer';
            syncArea.title = 'Click to sync now';
            syncArea.addEventListener('click', () => this.refreshFromCloud());
        }

        // Default date to today
        document.getElementById('tx-date').valueAsDate = new Date();

        // Setup Loan Portfolio Listeners
        document.getElementById('loan-search')?.addEventListener('input', () => this.renderLoans());
    },

    async updateConnectionStatus() {
        const dot = document.getElementById('connection-status');
        const syncEl = document.getElementById('sync-status');
        if (!dot || !syncEl) return;

        const connected = await Store.checkConnection();

        if (Store.syncBlocked) {
            dot.className = `w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]`;
            dot.title = 'Sync Blocked: Connection error on startup. Changes not saving.';
            syncEl.innerText = 'Offline - Read Only';
            syncEl.className = 'text-[8px] text-orange-500 uppercase tracking-tighter font-bold';
        } else if (connected) {
            dot.className = `w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]`;
            dot.title = 'Cloud Connected';
            if (Store.data.lastSync) {
                const last = new Date(Store.data.lastSync);
                syncEl.innerText = `Saved: ${last.getHours()}:${String(last.getMinutes()).padStart(2, '0')}`;
            } else {
                syncEl.innerText = 'Connected';
            }
            syncEl.className = 'text-[8px] text-slate-500 uppercase tracking-tighter';
        } else {
            dot.className = `w-1.5 h-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]`;
            dot.title = 'Cloud Offline - Changes saved locally only';
            syncEl.innerText = 'Offline - Local Only';
            syncEl.className = 'text-[8px] text-rose-500 uppercase tracking-tighter';
        }
    },

    async checkForUpdates() {
        if (Store.syncBlocked) return;
        const cloudTime = await Store.getLatestTimestamp();
        if (cloudTime && Store.data.lastSync) {
            const cloudDate = new Date(cloudTime);
            const localDate = new Date(Store.data.lastSync);

            if (cloudDate > localDate) {
                console.log("Newer data found in cloud. Syncing...");
                await this.refreshFromCloud();
            }
        }
    },

    async refreshFromCloud() {
        Auth.showToast("Syncing with cloud...");
        const status = await Store.loadFromCloud();

        if (status === 'SUCCESS' || status === 'EMPTY') {
            // Unblock sync if successful
            Store.syncBlocked = false;
            await this.renderAll();
            this.updateConnectionStatus();
            Auth.showToast("Data synced successfully!");
        } else {
            console.error("Manual Sync Failed:", status);
            // Show specific error to user for debugging
            if (status === 'CLIENT_MISSING') Auth.showToast("Sync Failed: Cloud library missing.", "error");
            else if (status.startsWith('NETWORK_ERROR')) Auth.showToast("Sync Failed: Network Error.", "error");
            else Auth.showToast(`Sync Failed: ${status}`, "error");
        }
    },

    updateClock() {
        const now = new Date();
        this.displayDate.textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    },

    setupNavigation() {
        const navLinks = document.querySelectorAll('.nav-link, .mobile-nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                const view = link.dataset.view;
                this.switchView(view);

                // Update active states
                navLinks.forEach(l => l.classList.remove('active', 'text-sky-400', 'text-slate-500'));
                link.classList.add('active');
                if (link.classList.contains('mobile-nav-link')) {
                    link.classList.add('text-sky-400');
                } else {
                    link.classList.add('text-sky-400');
                }
            });
        });

        document.getElementById('summary-btn').addEventListener('click', () => this.showSummary());
        document.getElementById('mobile-summary-btn')?.addEventListener('click', () => this.showSummary());

        // Global Search
        document.getElementById('global-search-btn')?.addEventListener('click', () => this.showGlobalSearch());

        // Logout buttons (Desktop and Mobile)
        const logoutHandler = () => {
            Auth.logout();
            location.reload();
        };
        document.getElementById('logout-btn')?.addEventListener('click', logoutHandler);
        document.getElementById('mobile-logout-btn')?.addEventListener('click', logoutHandler);
        document.getElementById('mobile-logout-nav')?.addEventListener('click', logoutHandler);

        document.getElementById('fab-save')?.addEventListener('click', () => {
            document.getElementById('transaction-form').requestSubmit();
        });

        // History filters
        const searchInput = document.getElementById('history-search');
        const dateFilter = document.getElementById('history-date-filter');

        searchInput?.addEventListener('input', () => this.renderHistory());
        dateFilter?.addEventListener('change', () => this.renderHistory());

        // Admin checks
        if (Store.data.auth.currentUser?.role === 'admin') {
            document.getElementById('admin-groups-btn')?.classList.remove('hidden');
            document.getElementById('mobile-groups-nav')?.classList.remove('hidden');
            document.getElementById('mobile-admin-nav')?.classList.remove('hidden');
            document.getElementById('admin-nav')?.classList.remove('hidden');
        }
    },

    switchView(viewId) {
        document.querySelectorAll('.view-content').forEach(v => v.classList.add('hidden'));
        const targetView = document.getElementById(`view-${viewId}`);
        if (targetView) {
            targetView.classList.remove('hidden');
            this.currentView = viewId;
            const title = viewId.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            this.viewTitle.textContent = title;
            if (viewId === 'loans') this.renderLoans();
        }
    },

    async setupForms() {
        // Transactions
        const txForm = document.getElementById('transaction-form');
        if (txForm) {
            txForm.onsubmit = async (e) => {
                e.preventDefault();
                await this.handleTransactionSubmit();
            };
        }

        const txType = document.getElementById('tx-type');
        if (txType) {
            txType.onchange = () => {
                const isContra = txType.value === 'contra';
                document.getElementById('ledger-field').classList.toggle('hidden', isContra);
                document.getElementById('contra-to-field').classList.toggle('hidden', !isContra);
                document.getElementById('tx-account-label').textContent = isContra ? 'From Source' : 'Account';
                this.populateDropdowns();
            };
        }

        window.addEventListener('resize', () => {
            if (document.getElementById('view-transactions').style.display !== 'none') {
                this.populateDropdowns();
            }
        });

        // Ledger
        const ledgerForm = document.getElementById('ledger-form');
        if (ledgerForm) {
            ledgerForm.onsubmit = async (e) => {
                e.preventDefault();
                const name = document.getElementById('ledger-name').value;
                const groupId = document.getElementById('ledger-group-select').value;
                const ob = document.getElementById('ledger-opening-balance').value;
                if (name && groupId) {
                    await Store.addLedger(name, groupId, ob);
                    ledgerForm.reset();
                    await this.renderAll();
                    Auth.showToast("Ledger Added");
                }
            };
        }

        // Ledger Group
        const groupForm = document.getElementById('ledger-group-form');
        if (groupForm) {
            groupForm.onsubmit = async (e) => {
                e.preventDefault();
                const name = document.getElementById('group-name').value;
                if (name) {
                    await Store.addLedgerGroup(name);
                    groupForm.reset();
                    await this.renderAll();
                    Auth.showToast("Group Created");
                }
            };
        }

        // Account
        const accForm = document.getElementById('account-form');
        if (accForm) {
            accForm.onsubmit = async (e) => {
                e.preventDefault();
                const name = document.getElementById('account-name').value;
                const ob = document.getElementById('account-opening-balance').value;
                if (name) {
                    await Store.addAccount(name, ob);
                    accForm.reset();
                    await this.renderAll();
                    Auth.showToast("Account Created");
                }
            };
        }
    },


    async handleTransactionSubmit() {
        const tx = {
            date: document.getElementById('tx-date').value,
            type: document.getElementById('tx-type').value,
            accountId: document.getElementById('tx-account').value,
            ledgerId: document.getElementById('tx-ledger').value,
            toId: document.getElementById('tx-to').value,
            amount: parseFloat(document.getElementById('tx-amount').value),
            remark: document.getElementById('tx-remark').value
        };

        if (!tx.amount || !tx.accountId || (tx.type === 'contra' ? !tx.toId : !tx.ledgerId)) {
            Auth.showToast("Please fill required fields", "error");
            return;
        }

        let isDebtTransfer = false;

        let fromType = 'account';
        let toType = 'account';

        // --- Contra Validations ---
        if (tx.type === 'contra') {
            const accList = Store.data.accounts.map(a => String(a.id));
            const ledList = Store.data.ledgers.map(l => String(l.id));

            fromType = accList.includes(tx.accountId) ? 'account' : 'ledger';
            toType = accList.includes(tx.toId) ? 'account' : 'ledger';

            const from = fromType === 'account' ?
                Store.data.accounts.find(a => a.id == tx.accountId) :
                Store.data.ledgers.find(l => l.id == tx.accountId);

            const to = toType === 'account' ?
                Store.data.accounts.find(a => a.id == tx.toId) :
                Store.data.ledgers.find(l => l.id == tx.toId);

            // Store explicit types in transaction
            tx.fromType = fromType;
            tx.toType = toType;

            // 1. Prevent overlapping source/target
            if (tx.accountId == tx.toId) {
                Auth.showToast("Source and Target cannot be the same", "error");
                return;
            }

            const fromIsLedger = fromType === 'ledger';
            const toIsLedger = toType === 'ledger';
            isDebtTransfer = fromIsLedger && toIsLedger;

            // 2. Validation Logic
            if (fromIsLedger && from.groupId > 2) {
                // Bypass over-settle check ONLY if it's Ledger-to-Ledger (Debt Transfer)
                if (!isDebtTransfer) {
                    if (tx.amount > Math.abs(from.balance) + 0.001) {
                        Auth.showToast("Amount exceeds outstanding balance", "error");
                        return;
                    }
                }
            }

            if (toIsLedger && to.groupId > 2) {
                if (fromIsLedger) {
                    // Safety Rail: Must be same type (Payable/Receivable)
                    const sameSign = (from.balance >= 0 && to.balance >= 0) || (from.balance <= 0 && to.balance <= 0);
                    if (!sameSign) {
                        Auth.showToast("Cannot transfer between payable and receivable", "error");
                        return;
                    }
                }
            }
        }

        await Store.addTransaction(tx);
        document.getElementById('transaction-form').reset();
        // Default to today
        document.getElementById('tx-date').value = new Date().toISOString().split('T')[0];

        this.populateDropdowns();
        await this.renderAll();

        if (isDebtTransfer) {
            const from = Store.data.ledgers.find(l => l.id == tx.accountId);
            const to = Store.data.ledgers.find(l => l.id == tx.toId);
            Auth.showToast(`Debt transferred from ${from.name} to ${to.name}`);
        } else {
            Auth.showToast("Entry Saved");
        }
    },

    async renderAll() {
        this.populateDropdowns();
        this.renderHistory();
        this.renderLedgers();
        this.renderLedgerGroups();
        this.renderAccounts();
        this.renderLoans();
        if (Store.data.auth.currentUser?.role === 'admin') this.renderUsers();
    },

    populateDropdowns() {
        const ledgers = Store.data.ledgers.filter(l => l.enabled);
        const accounts = Store.data.accounts.filter(a => a.enabled);
        const groups = Store.data.ledgerGroups.filter(g => g.enabled);

        const type = document.getElementById('tx-type')?.value;
        const lSelect = document.getElementById('tx-ledger');
        const aSelect = document.getElementById('tx-account');
        const aLabel = document.getElementById('tx-account-label');
        const toSelect = document.getElementById('tx-to');
        const toField = document.getElementById('contra-to-field');
        const toLabel = toField ? toField.querySelector('label') : null;
        const lgSelect = document.getElementById('ledger-group-select');

        const formatDropdownText = (name, type, amount) => {
            const isMobile = window.innerWidth < 768;
            // Standard length for name part to push the brackets to the right
            const targetNameLen = isMobile ? 18 : 22;
            const truncatedName = name.length > targetNameLen ? name.slice(0, targetNameLen - 3) + '...' : name;
            const namePart = truncatedName.padEnd(targetNameLen, '\u00A0');

            // Fixed width for type (Pay / Recv / Cash)
            const typePart = type.padEnd(4, '\u00A0');

            // Fixed width for amount to align decimals
            const amountPart = amount.toFixed(3).padStart(isMobile ? 8 : 10, '\u00A0');

            return `${namePart} [${typePart}: ${amountPart}]`;
        };

        const getLedgerInfo = l => {
            const isPayable = l.groupId === 5;
            const isNeg = l.balance < 0;
            const effectiveOwe = isPayable ? !isNeg : isNeg;
            const typeLabel = effectiveOwe ? 'Pay' : 'Recv';
            const color = effectiveOwe ? '#f43f5e' : '#10b981';
            return { text: formatDropdownText(l.name, typeLabel, Math.abs(l.balance)), color };
        };

        const getAccountInfo = a => {
            return { text: formatDropdownText(a.name, 'Cash', a.balance), color: '#3b82f6' };
        };

        const optionsL = '<option value="">Select Ledger</option>' + ledgers.map(l => {
            const info = getLedgerInfo(l);
            return `<option value="${l.id}" style="color: ${info.color}">${info.text}</option>`;
        }).join('');

        const optionsA_Pure = '<option value="">Select Account</option>' + accounts.map(a => {
            const info = getAccountInfo(a);
            return `<option value="${a.id}" style="color: ${info.color}">${info.text}</option>`;
        }).join('');

        const optionsCombined = '<option value="">Select Source/Target</option>' +
            accounts.map(a => {
                const info = getAccountInfo(a);
                return `<option value="${a.id}" style="color: ${info.color}">Bank: ${info.text}</option>`;
            }).join('') +
            ledgers.map(l => {
                const info = getLedgerInfo(l);
                return `<option value="${l.id}" style="color: ${info.color}">Ledger: ${info.text}</option>`;
            }).join('');

        const optionsG = '<option value="">Select Group</option>' + groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');

        if (type === 'contra') {
            if (aSelect) aSelect.innerHTML = optionsCombined;
            if (toSelect) toSelect.innerHTML = optionsCombined;
            if (aLabel) aLabel.textContent = "From (Source)";
            if (toLabel) toLabel.textContent = "To (Destination)";
        } else {
            if (aSelect) aSelect.innerHTML = optionsA_Pure;
            if (aLabel) aLabel.textContent = "Account";
        }

        if (lSelect) lSelect.innerHTML = optionsL;
        if (lgSelect) lgSelect.innerHTML = optionsG;
    },

    renderHistory() {
        const list = document.getElementById('tx-history-list');
        if (!list) return;

        const searchQuery = document.getElementById('history-search')?.value.toLowerCase();
        const dateFilter = document.getElementById('history-date-filter')?.value;

        let txs = [...Store.data.transactions].sort((a, b) => {
            if (b.date !== a.date) return b.date.localeCompare(a.date);
            return b.id - a.id; // Newest creation time first for same date
        });

        // Apply Date Filter
        if (dateFilter) {
            txs = txs.filter(t => t.date === dateFilter);
        } else if (!searchQuery) {
            // Show last 50 entries by default if no filters
            txs = txs.slice(0, 50);
        }

        // Apply Search Filter
        if (searchQuery) {
            txs = txs.filter(t => {
                const ledgerName = Store.data.ledgers.find(l => l.id == t.ledgerId)?.name.toLowerCase() || "";
                const accName = Store.data.accounts.find(a => a.id == t.accountId)?.name.toLowerCase() || "";
                const toName = (Store.data.accounts.find(a => a.id == t.toId)?.name || Store.data.ledgers.find(l => l.id == t.toId)?.name || "").toLowerCase();
                const remark = (t.remark || "").toLowerCase();
                return ledgerName.includes(searchQuery) || accName.includes(searchQuery) || toName.includes(searchQuery) || remark.includes(searchQuery);
            });
        }

        if (txs.length === 0) {
            list.innerHTML = `<div class="text-center py-8 text-slate-500 italic">${searchQuery || dateFilter ? 'No matching entries found' : 'No transactions yet'}</div>`;
            return;
        }

        list.innerHTML = txs.map(t => {
            const acc = Store.data.accounts.find(a => a.id == t.accountId)?.name || 'Unknown';
            const cat = t.type === 'contra'
                ? (Store.data.accounts.find(a => a.id == t.toId)?.name || Store.data.ledgers.find(l => l.id == t.toId)?.name || 'Target')
                : (Store.data.ledgers.find(l => l.id == t.ledgerId)?.name || 'General');

            const colorClass = t.type === 'expense' ? 'text-rose-400' : (t.type === 'income' ? 'text-emerald-400' : 'text-sky-400');
            const icon = t.type === 'expense' ? 'arrow-down' : (t.type === 'income' ? 'arrow-up' : 'exchange-alt');

            return `
                <div class="tx-card bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between group">
                    <div class="flex items-center space-x-4">
                        <div class="w-10 h-10 rounded-full bg-slate-950 flex items-center justify-center ${colorClass}">
                            <i class="fas fa-${icon}"></i>
                        </div>
                        <div>
                            <div class="font-medium">${cat} <span class="text-slate-500 text-xs ml-1">via ${acc}</span></div>
                            <div class="text-xs text-slate-500">${t.remark || 'No remark'}</div>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="font-orbitron font-bold ${colorClass}">${t.type === 'expense' ? '-' : '+'}${t.amount.toFixed(3)}</div>
                        <div class="flex justify-end space-x-1 md:opacity-0 md:group-hover:opacity-100 transition-all">
                            <button onclick="window.AppLogic.editTx(${t.id})" class="p-3 text-slate-500 hover:text-sky-500 transition-colors cursor-pointer" title="Edit">
                                <i class="fas fa-edit text-sm"></i>
                            </button>
                            <button onclick="window.AppLogic.deleteTx(${t.id})" class="p-3 text-slate-500 hover:text-rose-500 transition-colors cursor-pointer" title="Delete">
                                <i class="fas fa-trash-alt text-sm"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    async deleteTx(id) {
        if (confirm("Delete this transaction?")) {
            await Store.deleteTransaction(id);
            await this.renderAll();
            Auth.showToast("Entry Deleted", "error");
        }
    },

    editTx(id) {
        const t = Store.data.transactions.find(tx => tx.id === id);
        const ledgers = Store.data.ledgers.filter(l => l.enabled || l.id == t.ledgerId);
        const accounts = Store.data.accounts.filter(a => a.enabled || a.id == t.accountId || a.id == t.toId);

        let html = `
            <div id="modal-content" class="bg-slate-900 w-full max-w-lg rounded-t-3xl md:rounded-3xl p-8 space-y-6 shadow-2xl border-t border-slate-800 animate-fade-in max-h-[90vh] overflow-y-auto">
                <div class="flex items-center justify-between">
                    <h3 class="text-xl font-bold font-orbitron text-sky-400">Edit Transaction</h3>
                    <button onclick="document.getElementById('modal-container').classList.add('hidden')" class="text-slate-500"><i class="fas fa-times"></i></button>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1">Date</label>
                        <input type="date" id="edit-tx-date" value="${t.date}" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500">
                    </div>
                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1">Type</label>
                        <select id="edit-tx-type" onchange="window.AppLogic.toggleEditTxFields()" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5">
                            <option value="expense" ${t.type === 'expense' ? 'selected' : ''}>Expense</option>
                            <option value="income" ${t.type === 'income' ? 'selected' : ''}>Income</option>
                            <option value="contra" ${t.type === 'contra' ? 'selected' : ''}>Contra</option>
                        </select>
                    </div>
                    <div id="edit-ledger-field" class="space-y-1 ${t.type === 'contra' ? 'hidden' : ''}">
                        <label class="text-xs text-slate-500 ml-1">Ledger</label>
                        <select id="edit-tx-ledger" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5">
                            ${ledgers.map(l => `<option value="${l.id}" ${l.id == t.ledgerId ? 'selected' : ''}>${l.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="space-y-1">
                        <label id="edit-tx-account-label" class="text-xs text-slate-500 ml-1">${t.type === 'contra' ? 'From Source' : 'Account'}</label>
                        <select id="edit-tx-account" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5">
                            ${t.type === 'contra'
                ? accounts.map(a => `<option value="${a.id}" ${a.id == t.accountId ? 'selected' : ''}>Bank: ${a.name}</option>`).join('') +
                ledgers.map(l => `<option value="${l.id}" ${l.id == t.accountId ? 'selected' : ''}>Ledger: ${l.name}</option>`).join('')
                : accounts.map(a => `<option value="${a.id}" ${a.id == t.accountId ? 'selected' : ''}>${a.name}</option>`).join('')
            }
                        </select>
                    </div>
                    <div id="edit-contra-to-field" class="space-y-1 ${t.type !== 'contra' ? 'hidden' : ''}">
                        <label class="text-xs text-slate-500 ml-1">To Target</label>
                        <select id="edit-tx-to" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5">
                            ${accounts.map(a => `<option value="${a.id}" ${a.id == t.toId ? 'selected' : ''}>Bank: ${a.name}</option>`).join('')}
                            ${ledgers.map(l => `<option value="${l.id}" ${l.id == t.toId ? 'selected' : ''}>Ledger: ${l.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1">Amount</label>
                        <input type="number" step="0.001" id="edit-tx-amount" value="${t.amount}" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 font-orbitron">
                    </div>
                    <div class="md:col-span-2 space-y-1">
                        <label class="text-xs text-slate-500 ml-1">Remark</label>
                        <input type="text" id="edit-tx-remark" value="${t.remark || ''}" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5">
                    </div>
                </div>

                <div class="flex space-x-3 pt-4">
                    <button onclick="document.getElementById('modal-container').classList.add('hidden')" class="flex-1 bg-slate-800 text-slate-300 py-3 rounded-xl font-bold">Cancel</button>
                    <button onclick="window.AppLogic.saveTxEdit(${id})" class="flex-1 bg-sky-500 text-slate-950 py-3 rounded-xl font-bold shadow-lg shadow-sky-500/20">Update Entry</button>
                </div>
            </div>
        `;

        this.modalContainer.innerHTML = html;
        this.modalContainer.classList.remove('hidden');
    },

    toggleEditTxFields() {
        const type = document.getElementById('edit-tx-type').value;
        const ledgerField = document.getElementById('edit-ledger-field');
        const contraField = document.getElementById('edit-contra-to-field');
        const accountLabel = document.getElementById('edit-tx-account-label');
        const accountSelect = document.getElementById('edit-tx-account');

        ledgerField.classList.toggle('hidden', type === 'contra');
        contraField.classList.toggle('hidden', type !== 'contra');

        if (accountLabel) accountLabel.textContent = type === 'contra' ? 'From Source' : 'Account';

        // Optional: Re-populate accountSelect if type changes to/from contra in edit modal
        // For now, the user can just close and re-open edit if they change type radically, 
        // but let's try to handle it.
        if (accountSelect) {
            const currentVal = accountSelect.value;
            const ledgers = Store.data.ledgers.filter(l => l.enabled || l.id == currentVal);
            const accounts = Store.data.accounts.filter(a => a.enabled || a.id == currentVal);

            const getLedgerText = l => `${l.name}${l.groupId > 2 ? ` [${l.balance >= 0 ? 'Recv' : 'Pay'}: ${Math.abs(l.balance).toFixed(3)}]` : ''}`;
            const getAccountText = a => `${a.name} [${a.balance.toFixed(3)}]`;

            if (type === 'contra') {
                accountSelect.innerHTML = accounts.map(a => `<option value="${a.id}" ${a.id == currentVal ? 'selected' : ''}>Bank: ${getAccountText(a)}</option>`).join('') +
                    ledgers.map(l => `<option value="${l.id}" ${l.id == currentVal ? 'selected' : ''}>Ledger: ${getLedgerText(l)}</option>`).join('');
            } else {
                accountSelect.innerHTML = accounts.map(a => `<option value="${a.id}" ${a.id == currentVal ? 'selected' : ''}>${getAccountText(a)}</option>`).join('');
            }
        }
    },

    async saveTxEdit(id) {
        const updated = {
            date: document.getElementById('edit-tx-date').value,
            type: document.getElementById('edit-tx-type').value,
            accountId: document.getElementById('edit-tx-account').value,
            ledgerId: document.getElementById('edit-tx-ledger').value,
            toId: document.getElementById('edit-tx-to').value,
            amount: parseFloat(document.getElementById('edit-tx-amount').value),
            remark: document.getElementById('edit-tx-remark').value
        };

        if (!updated.amount || !updated.accountId || (updated.type !== 'contra' && !updated.ledgerId) || (updated.type === 'contra' && !updated.toId)) {
            Auth.showToast("Please fill all fields", "error");
            return;
        }

        // --- Contra Validations ---
        if (updated.type === 'contra') {
            const accList = Store.data.accounts.map(a => String(a.id));
            const ledList = Store.data.ledgers.map(l => String(l.id));

            const fromType = accList.includes(updated.accountId) ? 'account' : 'ledger';
            const toType = ledList.includes(updated.toId) ? 'ledger' : 'account'; // Prioritize account if ambiguous

            const from = fromType === 'account' ? Store.data.accounts.find(a => a.id == updated.accountId) : Store.data.ledgers.find(l => l.id == updated.accountId);
            const to = toType === 'account' ? Store.data.accounts.find(a => a.id == updated.toId) : Store.data.ledgers.find(l => l.id == updated.toId);

            if (updated.accountId == updated.toId && fromType === toType) {
                Auth.showToast("Source and Target cannot be the same", "error");
                return;
            }

            updated.fromType = fromType;
            updated.toType = toType;

            const fromIsLedger = fromType === 'ledger';
            const toIsLedger = toType === 'ledger';
            const isDebtTransfer = fromIsLedger && toIsLedger;

            if (fromIsLedger && from.groupId > 2) {
                // Bypass over-settle check ONLY if it's Ledger-to-Ledger (Debt Transfer)
                if (!isDebtTransfer) {
                    const oldTx = Store.data.transactions.find(t => t.id === id);
                    let available = Math.abs(from.balance);
                    if (oldTx && oldTx.accountId == updated.accountId) available += oldTx.amount;

                    if (updated.amount > available + 0.001) {
                        Auth.showToast("Amount exceeds outstanding balance", "error");
                        return;
                    }
                }
            }

            if (toIsLedger && to.groupId > 2) {
                if (fromIsLedger) {
                    const sameSign = (from.balance >= 0 && to.balance >= 0) || (from.balance <= 0 && to.balance <= 0);
                    if (!sameSign) {
                        Auth.showToast("Cannot transfer between payable and receivable", "error");
                        return;
                    }
                }
            }
        }

        await Store.updateTransaction(id, updated);
        this.modalContainer.classList.add('hidden');
        await this.renderAll();
        Auth.showToast("Transaction Updated");
    },

    renderLedgers() {
        const list = document.getElementById('ledger-list');
        list.innerHTML = Store.data.ledgers.map(l => {
            const groupName = Store.data.ledgerGroups.find(g => g.id == l.groupId)?.name || 'Unknown';
            const isRolling = l.groupId > 2;
            const isPayable = l.groupId === 5;
            const label = l.balance < 0
                ? (isPayable ? 'He Owes Me' : 'I Owe Him')
                : (isPayable ? 'I Owe' : 'He Owes Me');
            const labelColor = (l.balance < 0)
                ? (isPayable ? 'bg-sky-500/10 text-sky-500' : 'bg-rose-500/10 text-rose-500')
                : (isPayable ? 'bg-rose-500/10 text-rose-500' : 'bg-sky-500/10 text-sky-500');
            const amountColor = (l.balance < 0)
                ? (isPayable ? 'text-sky-400' : 'text-rose-400')
                : (isPayable ? 'text-rose-400' : 'text-sky-400');

            const balanceText = isRolling && Math.abs(l.balance) > 0.0001
                ? `<div class="mt-2 flex items-center space-x-2">
                     <span class="font-orbitron font-bold text-lg ${amountColor}">
                        ${l.balance < 0 ? '' : '+'}${l.balance.toFixed(3)}
                     </span>
                     <span class="px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${labelColor}">
                        ${label}
                     </span>
                   </div>`
                : '';

            return `
                <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between group hover:border-sky-500/30 transition-all cursor-pointer shadow-lg" onclick="window.AppLogic.showStatement('ledger', ${l.id})">
                    <div class="flex-1">
                       <div class="font-bold text-slate-100 flex items-center uppercase tracking-wide">
                           ${l.name}
                       </div>
                       <div class="text-[9px] text-slate-500 uppercase tracking-[0.2em] font-medium">${groupName}</div>
                       ${balanceText}
                    </div>
                    <div class="flex flex-col items-end space-y-2 ml-4">
                        <div class="flex space-x-1 md:opacity-0 md:group-hover:opacity-100 transition-all">
                            <button onclick="event.stopPropagation(); window.AppLogic.editLedger(${l.id})" class="p-3 text-sky-400 hover:bg-sky-400/10 rounded-2xl transition-all cursor-pointer">
                                <i class="fas fa-edit text-sm"></i>
                            </button>
                            <button onclick="event.stopPropagation(); window.AppLogic.deleteLedger(${l.id})" class="p-3 text-rose-400 hover:bg-rose-400/10 rounded-2xl transition-all cursor-pointer">
                                <i class="fas fa-trash-alt text-sm"></i>
                            </button>
                        </div>
                        <button onclick="event.stopPropagation(); window.AppLogic.toggle('ledgers', ${l.id})" class="p-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-500 hover:text-sky-400 transition-all">
                           <i class="fas fa-power-off text-xs"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    renderLedgerGroups() {
        const list = document.getElementById('ledger-group-list');
        if (!list) return;
        list.innerHTML = Store.data.ledgerGroups.map(g => `
            <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
                <div>
                   <div class="font-semibold text-lg text-slate-100">${g.name}</div>
                   <div class="text-xs ${g.enabled ? 'text-emerald-400' : 'text-rose-400'}">${g.enabled ? 'Active' : 'Archived'}</div>
                </div>
                <div class="flex space-x-1">
                    <button onclick="window.AppLogic.editLedgerGroup(${g.id})" class="p-4 text-sky-400 hover:bg-sky-400/10 rounded-2xl transition-all cursor-pointer">
                       <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="window.AppLogic.deleteLedgerGroup(${g.id})" class="p-4 text-rose-500 hover:bg-rose-500/10 rounded-2xl transition-all cursor-pointer">
                       <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>
        `).join('');
    },

    editLedger(id) {
        const l = Store.data.ledgers.find(ledger => ledger.id === id);
        const groups = Store.data.ledgerGroups.filter(g => g.enabled);

        let html = `
            <div id="modal-content" class="bg-slate-900 w-full max-w-md rounded-t-3xl md:rounded-3xl p-8 space-y-6 shadow-2xl border-t border-slate-800 animate-fade-in">
                <div class="flex items-center justify-between">
                    <h3 class="text-xl font-bold font-orbitron text-sky-400">Edit Ledger</h3>
                    <button onclick="document.getElementById('modal-container').classList.add('hidden')" class="text-slate-500"><i class="fas fa-times"></i></button>
                </div>
                
                <div class="space-y-4">
                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1">Ledger Name</label>
                        <input type="text" id="edit-ledger-name" value="${l.name}" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-1 focus:ring-sky-500">
                    </div>
                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1">Ledger Group</label>
                        <select id="edit-ledger-group" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-1 focus:ring-sky-500">
                            ${groups.map(g => `<option value="${g.id}" ${g.id == l.groupId ? 'selected' : ''}>${g.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1">Opening Balance</label>
                        <input type="number" step="0.001" id="edit-ledger-ob" value="${l.openingBalance || 0}" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-1 focus:ring-sky-500 font-orbitron">
                    </div>
                </div>

                <div class="flex space-x-3 pt-4">
                    <button onclick="document.getElementById('modal-container').classList.add('hidden')" class="flex-1 bg-slate-800 text-slate-300 py-3 rounded-xl font-bold">Cancel</button>
                    <button onclick="window.AppLogic.saveLedgerEdit(${id})" class="flex-1 bg-sky-500 text-slate-950 py-3 rounded-xl font-bold shadow-lg shadow-sky-500/20">Save Changes</button>
                </div>
            </div>
        `;

        this.modalContainer.innerHTML = html;
        this.modalContainer.classList.remove('hidden');
    },

    async saveLedgerEdit(id) {
        const name = document.getElementById('edit-ledger-name').value;
        const groupId = document.getElementById('edit-ledger-group').value;
        const ob = document.getElementById('edit-ledger-ob').value;
        if (name && groupId) {
            await Store.updateLedger(id, name, groupId, ob);
            this.modalContainer.classList.add('hidden');
            await this.renderAll();
            Auth.showToast("Ledger Updated");
        }
    },

    async deleteLedger(id) {
        if (confirm("Delete this ledger? Transactions will lose reference.")) {
            await Store.deleteLedger(id);
            await this.renderAll();
            Auth.showToast("Ledger Deleted", "error");
        }
    },

    async deleteLedgerGroup(id) {
        if (confirm("Delete this group? Ledgers will lose reference.")) {
            await Store.deleteLedgerGroup(id);
            await this.renderAll();
            Auth.showToast("Group Deleted", "error");
        }
    },

    editLedgerGroup(id) {
        const g = Store.data.ledgerGroups.find(group => group.id === id);
        let html = `
            <div id="modal-content" class="bg-slate-900 w-full max-w-md rounded-t-3xl md:rounded-3xl p-8 space-y-6 shadow-2xl border-t border-slate-800 animate-fade-in">
                <div class="flex items-center justify-between">
                    <h3 class="text-xl font-bold font-orbitron text-sky-400">Edit Ledger Group</h3>
                    <button onclick="document.getElementById('modal-container').classList.add('hidden')" class="text-slate-500"><i class="fas fa-times"></i></button>
                </div>
                
                <div class="space-y-4">
                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1">Group Name</label>
                        <input type="text" id="edit-group-name" value="${g.name}" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-1 focus:ring-sky-500">
                    </div>
                </div>

                <div class="flex space-x-3 pt-4">
                    <button onclick="document.getElementById('modal-container').classList.add('hidden')" class="flex-1 bg-slate-800 text-slate-300 py-3 rounded-xl font-bold">Cancel</button>
                    <button onclick="window.AppLogic.saveLedgerGroupEdit(${id})" class="flex-1 bg-sky-500 text-slate-950 py-3 rounded-xl font-bold shadow-lg shadow-sky-500/20">Save Changes</button>
                </div>
            </div>
        `;
        this.modalContainer.innerHTML = html;
        this.modalContainer.classList.remove('hidden');
    },

    async saveLedgerGroupEdit(id) {
        const name = document.getElementById('edit-group-name').value;
        if (name) {
            await Store.updateLedgerGroup(id, name);
            this.modalContainer.classList.add('hidden');
            await this.renderAll();
            Auth.showToast("Group Updated");
        }
    },

    renderAccounts() {
        const list = document.getElementById('account-list');
        list.innerHTML = Store.data.accounts.map(a => `
            <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 group relative hover:border-sky-500/50 transition-all cursor-pointer" onclick="window.AppLogic.showStatement('account', ${a.id})">
                <div class="flex items-center justify-between mb-2">
                   <div class="font-orbitron font-bold text-sky-400 text-lg">KWD ${a.balance.toFixed(3)}</div>
                   <div class="flex space-x-1 md:opacity-0 md:group-hover:opacity-100 transition-all">
                       <button onclick="event.stopPropagation(); window.AppLogic.editAccount(${a.id})" class="p-3 text-slate-400 hover:text-sky-400 transition-all cursor-pointer">
                           <i class="fas fa-edit text-xs"></i>
                       </button>
                       <button onclick="event.stopPropagation(); window.AppLogic.toggle('accounts', ${a.id})" class="p-3 text-slate-500 hover:text-rose-400 transition-all cursor-pointer">
                          <i class="fas fa-power-off text-xs"></i>
                       </button>
                   </div>
                </div>
                <div class="font-medium text-slate-300 font-orbitron tracking-tight">${a.name}</div>
                <div class="text-[10px] text-slate-500 uppercase tracking-widest mt-1">${a.enabled ? 'Bank / Cash' : 'Archived'}</div>
            </div>
        `).join('');
    },

    editAccount(id) {
        const a = Store.data.accounts.find(acc => acc.id === id);

        let html = `
            <div id="modal-content" class="bg-slate-900 w-full max-w-md rounded-t-3xl md:rounded-3xl p-8 space-y-6 shadow-2xl border-t border-slate-800 animate-fade-in">
                <div class="flex items-center justify-between">
                    <h3 class="text-xl font-bold font-orbitron text-sky-400">Edit Account</h3>
                    <button onclick="document.getElementById('modal-container').classList.add('hidden')" class="text-slate-500"><i class="fas fa-times"></i></button>
                </div>
                
                <div class="space-y-4">
                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1">Account Name</label>
                        <input type="text" id="edit-account-name" value="${a.name}" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-1 focus:ring-sky-500">
                    </div>
                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1">Opening Balance</label>
                        <input type="number" step="0.001" id="edit-account-ob" value="${a.openingBalance || 0}" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-1 focus:ring-sky-500 font-orbitron">
                    </div>
                </div>

                <div class="flex space-x-3 pt-4">
                    <button onclick="document.getElementById('modal-container').classList.add('hidden')" class="flex-1 bg-slate-800 text-slate-300 py-3 rounded-xl font-bold">Cancel</button>
                    <button onclick="window.AppLogic.saveAccountEdit(${id})" class="flex-1 bg-sky-500 text-slate-950 py-3 rounded-xl font-bold shadow-lg shadow-sky-500/20">Save Changes</button>
                </div>
            </div>
        `;

        this.modalContainer.innerHTML = html;
        this.modalContainer.classList.remove('hidden');
    },

    async saveAccountEdit(id) {
        const name = document.getElementById('edit-account-name').value;
        const ob = document.getElementById('edit-account-ob').value;
        if (name) {
            await Store.updateAccount(id, name, ob);
            this.modalContainer.classList.add('hidden');
            await this.renderAll();
            Auth.showToast("Account Updated");
        }
    },

    renderUsers() {
        const list = document.getElementById('user-management-list');
        list.innerHTML = Store.data.users.map(u => `
            <div class="flex items-center justify-between p-4 bg-slate-950 border border-slate-800 rounded-xl">
                <div>
                    <span class="font-medium text-slate-100">${u.username}</span>
                    <span class="ml-2 text-xs bg-slate-800 px-2 py-0.5 rounded uppercase text-slate-400">${u.role}</span>
                </div>
                <div class="flex space-x-2 text-xs">
                    <button class="text-sky-400 hover:text-sky-200" onclick="AppLogic.resetPass(${u.id})">Reset Pass</button>
                    <button class="${u.enabled ? 'text-emerald-400' : 'text-rose-400'}" onclick="AppLogic.toggle('users', ${u.id})">${u.enabled ? 'Enabled' : 'Disabled'}</button>
                </div>
            </div>
        `).join('');
    },

    exportData() {
        try {
            const dataStr = JSON.stringify(Store.data, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const dateStr = new Date().toISOString().split('T')[0];
            link.href = url;
            link.download = `antigravity_backup_${dateStr}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            Auth.showToast("Backup downloaded!");
        } catch (e) {
            Auth.showToast("Export failed", "error");
        }
    },

    triggerImport() {
        document.getElementById('import-input').click();
    },

    importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedData = JSON.parse(e.target.result);

                // Basic validation
                if (!importedData.transactions || !importedData.accounts || !importedData.ledgers) {
                    throw new Error("Invalid format");
                }

                if (confirm("This will overwrite your CURRENT data and logout. Continue?")) {
                    Store.data = importedData;
                    Store.save();
                    Auth.logout();
                    location.reload();
                }
            } catch (err) {
                Auth.showToast("Invalid backup file", "error");
            }
        };
        reader.readAsText(file);
        event.target.value = ''; // Reset input
    },

    async syncBalances() {
        await Store.recalculateBalances();
        await this.renderAll();
        Auth.showToast("Balances Resynced");
    },

    async toggle(type, id) {
        await Store.toggleStatus(type, id);
        await this.renderAll();
    },

    async resetPass(id) {
        const newPass = prompt("Enter new password:");
        if (newPass) {
            await Store.updateUserPassword(id, newPass);
            Auth.showToast("Password Updated");
        }
    },

    showSummary() {
        const accounts = Store.data.accounts.filter(a => Math.abs(a.balance) > 0.0001);
        const rollingLedgers = Store.data.ledgers.filter(l => l.groupId > 2 && Math.abs(l.balance) > 0.0001);

        const totalAccounts = Store.data.accounts.reduce((sum, a) => sum + a.balance, 0);
        const totalReceivables = rollingLedgers.filter(l => (l.groupId !== 5 && l.balance > 0) || (l.groupId === 5 && l.balance < 0))
            .reduce((sum, l) => sum + Math.abs(l.balance), 0);
        const totalPayables = rollingLedgers.filter(l => (l.groupId !== 5 && l.balance < 0) || (l.groupId === 5 && l.balance > 0))
            .reduce((sum, l) => sum + Math.abs(l.balance), 0);
        const myMoney = totalAccounts + totalReceivables - totalPayables;

        let html = `
            <div id="modal-content" class="bg-slate-950 w-full max-w-2xl rounded-t-3xl md:rounded-3xl p-6 lg:p-8 space-y-8 shadow-2xl border-t border-slate-800 animate-fade-in max-h-[90vh] overflow-y-auto relative">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-2xl font-bold font-orbitron text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-500">Financial Summary</h3>
                        <p class="text-[10px] text-slate-500 uppercase tracking-widest mt-1">Snapshot of your net positions</p>
                    </div>
                    <button onclick="document.getElementById('modal-container').classList.add('hidden')" class="text-slate-500 hover:text-white p-2 transition-colors"><i class="fas fa-times text-xl"></i></button>
                </div>

            <div class="grid grid-cols-3 gap-2 md:gap-6">
            <div onclick="AppLogic.showTotalMoneyStatement()" class="bg-slate-900/50 p-3 md:p-6 rounded-2xl md:rounded-3xl border border-slate-800 shadow-xl text-center cursor-pointer hover:border-teal-500/50 transition-all group active:scale-95">
                <div class="text-[8px] md:text-[10px] text-slate-500 uppercase tracking-widest mb-1 font-bold group-hover:text-teal-400 transition-colors">Net Worth</div>
                <div class="text-xs md:text-2xl font-bold font-orbitron text-white line-clamp-1 group-hover:text-teal-400 transition-colors">${myMoney.toFixed(2)}</div>
                <div class="text-[6px] md:text-[8px] text-teal-500/50 uppercase tracking-tighter mt-1 opacity-0 group-hover:opacity-100 transition-opacity font-bold">View Statement</div>
            </div>
            <div class="bg-slate-900/50 p-3 md:p-6 rounded-2xl md:rounded-3xl border border-slate-800 shadow-xl text-center">
                <div class="text-[8px] md:text-[10px] text-emerald-500/70 uppercase tracking-widest mb-1 font-bold">Recv</div>
                <div class="text-xs md:text-2xl font-bold font-orbitron text-emerald-400 line-clamp-1">${totalReceivables.toFixed(2)}</div>
            </div>
            <div class="bg-slate-900/50 p-3 md:p-6 rounded-2xl md:rounded-3xl border border-slate-800 shadow-xl text-center">
                <div class="text-[8px] md:text-[10px] text-rose-500/70 uppercase tracking-widest mb-1 font-bold">Pay</div>
                <div class="text-xs md:text-2xl font-bold font-orbitron text-rose-400 line-clamp-1">${totalPayables.toFixed(2)}</div>
            </div>
        </div>

                <div class="space-y-6">
                    <div>
                        <h4 class="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center">
                            <i class="fas fa-university mr-2"></i> Cash & Banks
                        </h4>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            ${accounts.map(a => `
                                <div class="bg-slate-900 border border-slate-800/50 p-4 rounded-2xl flex justify-between items-center group hover:border-sky-500/30 transition-all cursor-pointer" onclick="AppLogic.showStatement('account', ${a.id})">
                                    <span class="text-slate-300 font-medium">${a.name}</span>
                                    <span class="font-orbitron font-bold text-sky-400">${a.balance.toFixed(3)}</span>
                                </div>
                            `).join('')}
                        </div>
                        <div class="mt-3 bg-sky-500/10 border border-sky-500/20 p-4 rounded-2xl flex justify-between items-center">
                            <span class="text-sky-400 font-bold uppercase tracking-wider text-xs">Total Cash & Bank</span>
                            <span class="font-orbitron font-bold text-sky-400 border-b-2 border-sky-400/50 pb-0.5">${totalAccounts.toFixed(3)}</span>
                        </div>
                    </div>

                    ${rollingLedgers.length > 0 ? `
                    <div>
                        <h4 class="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center">
                            <i class="fas fa-file-invoice-dollar mr-2"></i> Rolling Balances
                        </h4>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            ${rollingLedgers.map(l => {
            const isPayable = l.groupId === 5;
            const isNeg = l.balance < 0;
            const effectiveOwe = isPayable ? !isNeg : isNeg;
            return `
                                    <div class="bg-slate-900 border border-slate-800/50 p-4 rounded-2xl flex justify-between items-center group hover:border-sky-500/30 transition-all cursor-pointer" onclick="AppLogic.showStatement('ledger', ${l.id})">
                                        <div>
                                            <div class="text-slate-300 font-medium text-sm">${l.name}</div>
                                            <div class="text-[9px] uppercase tracking-widest ${effectiveOwe ? 'text-rose-400' : 'text-emerald-400'}">
                                                ${effectiveOwe ? (isPayable ? 'Tithe/Payable' : 'I Owe Him') : (isPayable ? 'Overpaid' : 'He Owes Me')}
                                            </div>
                                        </div>
                                        <span class="font-orbitron font-bold ${effectiveOwe ? 'text-rose-400' : 'text-emerald-400'}">
                                            ${Math.abs(l.balance).toFixed(3)}
                                        </span>
                                    </div>
                                `;
        }).join('')}
                        </div>
                    </div>
                    ` : ''}
                </div>
                
                <button onclick="document.getElementById('modal-container').classList.add('hidden')" class="w-full bg-slate-800 text-slate-400 py-3 rounded-2xl font-bold hover:text-white transition-all">Close</button>
            </div>
        `;

        this.modalContainer.innerHTML = html;
        this.modalContainer.classList.remove('hidden');
    },

    showStatement(type, id, startStr, endStr) {
        const item = Store.data[type + 's'].find(i => i.id == id);

        // Default to current month if dates not provided
        const now = new Date();
        if (!startStr) {
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            startStr = firstDay.toISOString().split('T')[0];
        }
        if (!endStr) {
            endStr = now.toISOString().split('T')[0];
        }

        // Get ALL relevant transactions for this item, sorted by ID (timestamp)
        // --- 0. Precise Transaction Filtering ---
        const allRelevantTxs = Store.data.transactions.filter(t => {
            const targetId = String(id);
            const tFromId = String(t.accountId);
            const tToId = String(t.toId);
            const tLedId = String(t.ledgerId);

            if (type === 'account') {
                // In account mode, IDs 1, 2, 3... are strictly Banks/Cash
                if (t.type === 'contra') {
                    const from = Store.data.accounts.find(a => String(a.id) === tFromId);
                    const to = Store.data.accounts.find(a => String(a.id) === tToId);
                    // Only include if KFH (targetId) was involved AS AN ACCOUNT
                    const fromMatches = (tFromId === targetId && from);
                    const toMatches = (tToId === targetId && to);
                    return fromMatches || toMatches;
                }
                // For Income/Expense, accountId MUST be the bank/cash side
                return tFromId === targetId;
            } else {
                // Ledger mode: IDs 1, 2, 3... are strictly categories/people
                if (t.type === 'contra') {
                    const from = Store.data.ledgers.find(l => String(l.id) === tFromId);
                    const to = Store.data.ledgers.find(l => String(l.id) === tToId);
                    // Only include if this ledger was involved AS A LEDGER
                    const fromMatches = (tFromId === targetId && from);
                    const toMatches = (tToId === targetId && to);
                    return fromMatches || toMatches;
                }
                // For Income/Expense, ledgerId is the correct field for the entity
                return tLedId === targetId;
            }
        }).sort((a, b) => a.id - b.id);

        // Helper: Determine if transaction is IN or OUT for the current view
        const getSide = (t) => {
            let isIn = false, isOut = false;
            const targetId = String(id);
            const tFromId = String(t.accountId);
            const tToId = String(t.toId);
            const tLedId = String(t.ledgerId);

            if (type === 'account') {
                if (t.type === 'expense') isOut = (tFromId === targetId);
                else if (t.type === 'income') isIn = (tFromId === targetId);
                else if (t.type === 'contra') {
                    if (tFromId === targetId) isOut = true;
                    if (tToId === targetId) isIn = true;
                }
            } else {
                // Ledger Statement: KD leaving pocket/debt decreasing = OUT
                // Ledger Statement: KD coming in/debt increasing = IN
                if (t.type === 'expense') isOut = (tLedId === targetId);
                else if (t.type === 'income') isIn = (tLedId === targetId);
                else if (t.type === 'contra') {
                    // Moving debt from Source (tFromId) to Target (tToId)
                    if (tFromId === targetId) isIn = true; // Source gets balance + KD (Debt decreases/IN to pocket)
                    if (tToId === targetId) isOut = true; // Target gets balance - KD (Debt increases/OUT from pocket)
                }
            }
            return { isIn, isOut };
        };

        // 1. Calculate Opening Balance (Everything before startStr)
        let periodOpeningBal = item.openingBalance || 0;
        allRelevantTxs.filter(t => t.date < startStr).forEach(t => {
            const { isIn, isOut } = getSide(t);
            if (isIn) periodOpeningBal += (type === 'ledger' && item.groupId > 2) ? -t.amount : t.amount;
            if (isOut) periodOpeningBal += (type === 'ledger' && item.groupId > 2) ? t.amount : -t.amount;
        });

        // 2. Map and Map Current Period Transactions
        const periodTxs = allRelevantTxs.filter(t => t.date >= startStr && t.date <= endStr);
        let runningBal = periodOpeningBal;
        let totalIn = 0;
        let totalOut = 0;

        const statementRows = periodTxs.map(t => {
            const { isIn, isOut } = getSide(t);
            if (isIn) {
                totalIn += t.amount;
                runningBal += (type === 'ledger' && item.groupId > 2) ? -t.amount : t.amount;
            }
            if (isOut) {
                totalOut += t.amount;
                runningBal += (type === 'ledger' && item.groupId > 2) ? t.amount : -t.amount;
            }
            return { ...t, isIn, isOut, currentBal: runningBal };
        });

        let html = `
            <div onclick="this.parentElement.classList.add('hidden')" 
                class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4 z-[3000]">
                <div onclick="event.stopPropagation()" 
                    id="modal-content" class="bg-slate-900 w-full max-w-3xl rounded-t-3xl md:rounded-3xl p-6 lg:p-8 space-y-4 shadow-2xl border-t border-slate-800 transform animate-fade-in flex flex-col max-h-[90vh]">
                    
                    <div class="flex items-center justify-between">
                        <div>
                            <h2 class="text-xl font-bold font-orbitron text-slate-100">${item.name}</h2>
                            <p class="text-[10px] text-slate-500 uppercase tracking-widest">Statement History</p>
                        </div>
                        <div class="flex items-center space-x-3">
                            <button onclick="AppLogic.exportStatementToExcel('${type}', ${id}, document.getElementById('stmt-start').value, document.getElementById('stmt-end').value)" class="hidden md:flex items-center space-x-2 bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg text-[10px] font-semibold border border-emerald-500/20 hover:bg-emerald-500/20 transition-all">
                                <i class="fas fa-file-excel"></i>
                                <span>Export</span>
                            </button>
                            <button onclick="document.getElementById('modal-container').classList.add('hidden')" class="text-slate-500 hover:text-slate-300 transition-colors">
                                <i class="fas fa-times text-lg"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Date Filters -->
                    <div class="bg-slate-950/50 p-3 rounded-2xl border border-slate-800/50 grid grid-cols-2 md:grid-cols-3 gap-3">
                        <div class="space-y-1">
                            <label class="text-[9px] text-slate-500 uppercase font-bold tracking-tight ml-1">From</label>
                            <input type="date" id="stmt-start" value="${startStr}" 
                                class="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-sky-500/50">
                        </div>
                        <div class="space-y-1">
                            <label class="text-[9px] text-slate-500 uppercase font-bold tracking-tight ml-1">To</label>
                            <input type="date" id="stmt-end" value="${endStr}" 
                                class="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-sky-500/50">
                        </div>
                        <div class="col-span-2 md:col-span-1 flex items-end">
                            <button onclick="AppLogic.showStatement('${type}', ${id}, document.getElementById('stmt-start').value, document.getElementById('stmt-end').value)" 
                                class="w-full bg-sky-500/10 text-sky-400 border border-sky-500/20 hover:bg-sky-500/20 py-1.5 rounded-lg text-xs font-bold transition-all uppercase tracking-wider">
                                Filter Rows
                            </button>
                        </div>
                    </div>

                    <div class="flex-1 overflow-x-auto overflow-y-auto pr-1 custom-scrollbar">
                        <table class="w-full text-left text-sm border-separate border-spacing-0">
                            <thead class="sticky top-0 bg-slate-900 text-slate-500 border-b border-slate-800 z-10">
                                <tr>
                                    <th class="py-3 px-2 font-bold uppercase text-[9px] tracking-widest border-b border-slate-800">Date</th>
                                    <th class="py-3 px-2 font-bold uppercase text-[9px] tracking-widest border-b border-slate-800">Particulars</th>
                                    <th class="py-3 px-2 font-bold uppercase text-[9px] tracking-widest text-rose-400 border-b border-slate-800">Out</th>
                                    <th class="py-3 px-2 font-bold uppercase text-[9px] tracking-widest text-emerald-400 border-b border-slate-800">In</th>
                                    <th class="py-3 px-2 font-bold uppercase text-[9px] tracking-widest text-sky-400 text-right border-b border-slate-800 font-orbitron">Balance</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-800/30">
                                ${statementRows.length === 0 ? `
                                    <tr>
                                        <td colspan="5" class="py-10 text-center text-slate-600 text-[10px] uppercase tracking-widest italic">No transactions found in this period</td>
                                    </tr>
                                ` : statementRows.reverse().map(t => {
            let relatedName = '-';
            if (type === 'account') {
                const led = Store.data.ledgers.find(l => l.id == t.ledgerId);
                if (led) relatedName = led.name;
                else if (t.type === 'contra') {
                    const otherAccId = t.accountId == id ? t.toId : t.accountId;
                    const otherAcc = Store.data.accounts.find(a => a.id == otherAccId);
                    relatedName = otherAcc ? `Trf: ${otherAcc.name}` : 'Transfer';
                }
            } else {
                const acc = Store.data.accounts.find(a => a.id == t.accountId);
                if (acc) relatedName = acc.name;
                else if (t.type === 'contra') {
                    const otherId = t.accountId == id ? t.toId : t.accountId;
                    const other = Store.data.accounts.find(a => a.id == otherId) || Store.data.ledgers.find(l => l.id == otherId);
                    relatedName = other ? `Trf: ${other.name}` : 'Transfer';
                }
            }

            return `
                                        <tr onclick="AppLogic.editTx(${t.id})" class="hover:bg-slate-800/50 transition-colors cursor-pointer group">
                                            <td class="py-3 px-2 whitespace-nowrap text-slate-400 text-[10px] font-orbitron group-hover:text-sky-400 transition-colors">${t.date.split('-').slice(1).reverse().join('/')}</td>
                                            <td class="py-3 px-2 max-w-[150px]">
                                                <div class="text-[9px] text-sky-400 font-bold uppercase truncate">
                                                    ${t.type === 'contra' ? relatedName : (relatedName || 'General')}
                                                </div>
                                                <div class="text-[9px] text-slate-500 truncate mt-0.5" title="${t.remark}">${t.remark || '-'}</div>
                                            </td>
                                            <td class="py-3 px-2 text-rose-400 font-orbitron text-[11px] font-medium">${t.isOut ? t.amount.toFixed(3) : '-'}</td>
                                            <td class="py-3 px-2 text-emerald-400 font-orbitron text-[11px] font-medium">${t.isIn ? t.amount.toFixed(3) : '-'}</td>
                                            <td class="py-3 px-2 text-right font-orbitron text-[11px] font-bold ${t.currentBal < 0 ? 'text-rose-400' : 'text-sky-400'}">
                                                ${t.currentBal < 0 ? '' : '+'}${t.currentBal.toFixed(3)}
                                            </td>
                                        </tr>
                                    `;
        }).join('')}

                                <!-- Opening Balance Row (at the bottom in DESC view) -->
                                <tr class="bg-slate-950/40">
                                    <td class="py-3 px-2 text-slate-500 font-orbitron text-[10px]" colspan="1">${startStr.split('-').slice(1).reverse().join('/')}</td>
                                    <td class="py-3 px-2 text-[10px] text-slate-400 font-bold uppercase tracking-tight" colspan="3">Opening Balance (B/F)</td>
                                    <td class="py-3 px-2 text-right font-orbitron text-xs text-slate-400">
                                        ${periodOpeningBal >= 0 ? '+' : ''}${periodOpeningBal.toFixed(3)}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Footer Summary -->
                    <div class="grid grid-cols-3 gap-3 pt-3 border-t border-slate-800">
                        <div class="bg-slate-950/30 p-2.5 rounded-xl border border-slate-800/50">
                            <div class="text-[7px] text-slate-500 uppercase tracking-widest mb-1">Total Paid</div>
                            <div class="text-xs font-bold font-orbitron text-rose-400">${totalOut.toFixed(3)}</div>
                        </div>
                        <div class="bg-slate-950/30 p-2.5 rounded-xl border border-slate-800/50">
                            <div class="text-[7px] text-slate-500 uppercase tracking-widest mb-1">Total Recv</div>
                            <div class="text-xs font-bold font-orbitron text-emerald-400">${totalIn.toFixed(3)}</div>
                        </div>
                        <div class="bg-slate-950/30 p-2.5 rounded-xl border border-sky-500/10">
                            <div class="text-[7px] text-sky-500/50 uppercase tracking-widest mb-1">End Balance</div>
                            <div class="text-xs font-bold font-orbitron ${runningBal < 0 ? 'text-rose-400' : 'text-sky-400'}">
                                ${runningBal < 0 ? '' : '+'}${runningBal.toFixed(3)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.modalContainer.innerHTML = html;
        this.modalContainer.classList.remove('hidden');
    },

    showTotalMoneyStatement(startStr, endStr) {
        const accounts = Store.data.accounts;
        const rollingLedgers = Store.data.ledgers.filter(l => l.groupId > 2);

        // Default to current month if dates not provided
        const now = new Date();
        if (!startStr) {
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            startStr = firstDay.toISOString().split('T')[0];
        }
        if (!endStr) {
            endStr = now.toISOString().split('T')[0];
        }

        // 1. Calculate Initial Base (Absolute Opening Balances)
        const initialAccountsVal = accounts.reduce((sum, a) => sum + (a.openingBalance || 0), 0);
        const initialRollingVal = rollingLedgers.reduce((sum, l) => sum + (l.openingBalance || 0), 0);
        let absoluteBaseNetWorth = initialAccountsVal + initialRollingVal;

        // 2. Sort ALL transactions to calculate current position
        const allTxs = [...Store.data.transactions].sort((a, b) => a.id - b.id);

        // Utility to calculate impact of a single transaction on "Internal Net Worth"
        const getImpact = (t) => {
            let impact = 0;
            if (t.type === 'expense') {
                const fromAcc = accounts.find(a => a.id == t.accountId);
                const toLed = Store.data.ledgers.find(l => l.id == t.ledgerId);
                if (fromAcc) impact -= t.amount;
                if (toLed && toLed.groupId > 2) impact += t.amount;
            } else if (t.type === 'income') {
                const toAcc = accounts.find(a => a.id == t.accountId);
                const fromLed = Store.data.ledgers.find(l => l.id == t.ledgerId);
                if (toAcc) impact += t.amount;
                if (fromLed && fromLed.groupId > 2) impact -= t.amount;
            } else if (t.type === 'contra') {
                const from = accounts.find(a => a.id == t.accountId) || Store.data.ledgers.find(l => l.id == t.accountId);
                const to = accounts.find(a => a.id == t.toId) || Store.data.ledgers.find(l => l.id == t.toId);

                if (from && to) {
                    const fromIsLedger = from.groupId !== undefined;
                    const toIsLedger = to.groupId !== undefined;

                    if (fromIsLedger && toIsLedger) {
                        // Ledger-to-Ledger Debt Transfer (Inversion Logic)
                        // Net Worth Impact: (+Amount to Source) + (-Amount to Target) = 0
                        impact = 0;
                    } else {
                        // Regular Account/Ledger Transfer
                        if (from.groupId === undefined || from.groupId > 2) impact -= t.amount;
                        if (to.groupId === undefined || to.groupId > 2) impact += t.amount;
                    }
                }
            }
            return impact;
        };

        // 3. Calculate Opening Net Worth for the period (Base + everything before startStr)
        let periodOpeningNetWorth = absoluteBaseNetWorth;
        allTxs.filter(t => t.date < startStr).forEach(t => {
            periodOpeningNetWorth += getImpact(t);
        });

        // 4. Process period transactions
        let runningNetWorth = periodOpeningNetWorth;
        let totalNetIn = 0;
        let totalNetOut = 0;
        const statementRows = [];

        allTxs.filter(t => t.date >= startStr && t.date <= endStr).forEach(t => {
            const impact = getImpact(t);
            if (Math.abs(impact) > 0.0001) {
                runningNetWorth += impact;
                if (impact > 0) totalNetIn += impact;
                else totalNetOut += Math.abs(impact);

                statementRows.push(`
                    <tr class="hover:bg-slate-950/50 transition-colors">
                        <td class="py-3 px-2 whitespace-nowrap text-slate-400 text-[11px] font-orbitron">${t.date.split('-').reverse().slice(0, 2).join('/')}</td>
                        <td class="py-3 px-2">
                            <div class="text-[10px] text-teal-500 font-bold uppercase tracking-tighter mb-0.5">${t.type}</div>
                            <div class="text-[10px] text-slate-300 truncate" title="${t.remark}">${t.remark || '-'}</div>
                        </td>
                        <td class="py-3 px-2 text-rose-400 font-orbitron text-xs font-medium">${impact < 0 ? Math.abs(impact).toFixed(3) : '-'}</td>
                        <td class="py-3 px-2 text-emerald-400 font-orbitron text-xs font-medium">${impact > 0 ? impact.toFixed(3) : '-'}</td>
                        <td class="py-3 px-2 text-right font-orbitron text-xs text-teal-400">
                            ${runningNetWorth.toFixed(3)}
                        </td>
                    </tr>
                `);
            }
        });

        const html = `
            <div id="modal-content" class="bg-slate-900 w-full max-w-4xl rounded-t-3xl md:rounded-3xl p-6 lg:p-8 space-y-4 shadow-2xl border-t border-slate-800 transform animate-fade-in flex flex-col max-h-[90vh]">
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-xl font-bold font-orbitron text-teal-400 uppercase tracking-tighter">Net Worth History</h2>
                        <p class="text-[9px] text-slate-500 uppercase tracking-widest">Growth & Position Tracking</p>
                    </div>
                    <button onclick="window.AppLogic.showSummary()" class="bg-slate-950/50 text-slate-500 hover:text-sky-400 border border-slate-800 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer">
                        <i class="fas fa-arrow-left mr-2"></i>Back to Summary
                    </button>
                </div>

                <!-- Date Filter Bar -->
                <div class="bg-slate-950/50 p-3 rounded-2xl border border-slate-800/50 grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div class="space-y-1">
                        <label class="text-[9px] text-slate-500 uppercase font-bold tracking-tight ml-1">From</label>
                        <input type="date" id="nw-start" value="${startStr}" 
                            class="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-teal-500/50">
                    </div>
                    <div class="space-y-1">
                        <label class="text-[9px] text-slate-500 uppercase font-bold tracking-tight ml-1">To</label>
                        <input type="date" id="nw-end" value="${endStr}" 
                            class="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-teal-500/50">
                    </div>
                    <div class="col-span-2 md:col-span-1 flex items-end">
                        <button onclick="AppLogic.showTotalMoneyStatement(document.getElementById('nw-start').value, document.getElementById('nw-end').value)" 
                            class="w-full bg-teal-500/10 text-teal-400 border border-teal-500/20 hover:bg-teal-500/20 py-1.5 rounded-lg text-xs font-bold transition-all uppercase tracking-wider">
                            Apply Filter
                        </button>
                    </div>
                </div>

                <div class="flex-1 overflow-x-auto overflow-y-auto pr-2 custom-scrollbar">
                    <table class="w-full text-left text-sm border-separate border-spacing-0">
                        <thead class="sticky top-0 bg-slate-900 text-slate-500 border-b border-slate-800 z-10">
                            <tr>
                                <th class="py-3 px-2 font-bold uppercase text-[9px] tracking-widest border-b border-slate-800">Date</th>
                                <th class="py-3 px-2 font-bold uppercase text-[9px] tracking-widest border-b border-slate-800">Remark / Type</th>
                                <th class="py-3 px-2 font-bold uppercase text-[9px] tracking-widest text-rose-400 border-b border-slate-800">Value Out</th>
                                <th class="py-3 px-2 font-bold uppercase text-[9px] tracking-widest text-emerald-400 border-b border-slate-800">Value In</th>
                                <th class="py-3 px-2 font-bold uppercase text-[9px] tracking-widest text-teal-400 text-right border-b border-slate-800">Net Position</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-800/30">
                            ${statementRows.reverse().join('')}
                            <tr class="bg-slate-950/30">
                                <td class="py-3 px-2 text-[10px] text-slate-500 font-bold uppercase" colspan="2">Net Worth (B/F) at ${startStr.split('-').reverse().slice(0, 2).join('/')}</td>
                                <td class="py-3 px-2" colspan="2"></td>
                                <td class="py-3 px-2 text-right font-orbitron text-xs text-slate-400">
                                    ${periodOpeningNetWorth.toFixed(3)}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="grid grid-cols-3 gap-4 pt-4 border-t border-slate-800">
                    <div class="bg-slate-950 p-3 rounded-xl border border-slate-800/50">
                        <div class="text-[8px] text-slate-500 uppercase tracking-widest mb-1">Total Net Gain</div>
                        <div class="text-sm font-bold font-orbitron text-emerald-400">+${totalNetIn.toFixed(3)}</div>
                    </div>
                    <div class="bg-slate-950 p-3 rounded-xl border border-slate-800/50">
                        <div class="text-[8px] text-slate-500 uppercase tracking-widest mb-1">Total Net Loss</div>
                        <div class="text-sm font-bold font-orbitron text-rose-400">-${totalNetOut.toFixed(3)}</div>
                    </div>
                    <div class="bg-slate-950 p-3 rounded-xl border border-teal-500/20">
                        <div class="text-[8px] text-teal-500/50 uppercase tracking-widest mb-1">Selected End Net</div>
                        <div class="text-sm font-bold font-orbitron text-teal-400">
                            ${runningNetWorth.toFixed(3)}
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.modalContainer.innerHTML = html;
        this.modalContainer.classList.remove('hidden');
    },

    showGlobalSearch() {
        const html = `
            <div onclick="this.parentElement.classList.add('hidden')" 
                class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-start justify-center p-4 pt-20 md:pt-32">
                <div onclick="event.stopPropagation()" 
                    class="w-full max-w-2xl bg-slate-900 rounded-3xl border border-slate-800 shadow-2xl animate-fade-in overflow-hidden">
                    
                    <!-- Search Input -->
                    <div class="p-6 border-b border-slate-800">
                        <div class="relative">
                            <i class="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"></i>
                            <input type="text" id="global-search-input" 
                                placeholder="Search ledgers and accounts..." 
                                autocomplete="off"
                                class="w-full bg-slate-800 border border-slate-700 rounded-xl pl-12 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all text-lg">
                        </div>
                    </div>

                    <!-- Results -->
                    <div id="search-results" class="max-h-96 overflow-y-auto p-4 space-y-2">
                        <div class="text-center text-slate-500 py-8">
                            <i class="fas fa-search text-4xl mb-3"></i>
                            <p>Start typing to search...</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.modalContainer.innerHTML = html;
        this.modalContainer.classList.remove('hidden');

        // Focus search input
        setTimeout(() => {
            const input = document.getElementById('global-search-input');
            input?.focus();

            // Add real-time search
            input?.addEventListener('input', (e) => {
                this.handleGlobalSearch(e.target.value);
            });
        }, 100);
    },

    handleGlobalSearch(query) {
        const resultsContainer = document.getElementById('search-results');
        if (!resultsContainer) return;

        if (!query || query.trim().length < 1) {
            resultsContainer.innerHTML = `
                <div class="text-center text-slate-500 py-8">
                    <i class="fas fa-search text-4xl mb-3"></i>
                    <p>Start typing to search...</p>
                </div>
            `;
            return;
        }

        const searchTerm = query.toLowerCase();
        const results = [];

        // Search Ledgers
        Store.data.ledgers.forEach(ledger => {
            if (ledger.enabled && ledger.name.toLowerCase().includes(searchTerm)) {
                const group = Store.data.ledgerGroups.find(g => g.id === ledger.groupId);
                results.push({
                    type: 'ledger',
                    id: ledger.id,
                    name: ledger.name,
                    subtitle: group?.name || 'Ledger',
                    balance: ledger.balance,
                    icon: 'fa-list-ul'
                });
            }
        });

        // Search Accounts
        Store.data.accounts.forEach(account => {
            if (account.enabled && account.name.toLowerCase().includes(searchTerm)) {
                results.push({
                    type: 'account',
                    id: account.id,
                    name: account.name,
                    subtitle: 'Account',
                    balance: account.balance,
                    icon: 'fa-university'
                });
            }
        });

        // Render Results
        if (results.length === 0) {
            resultsContainer.innerHTML = `
                <div class="text-center text-slate-500 py-8">
                    <i class="fas fa-search-minus text-4xl mb-3"></i>
                    <p>No results found for "${query}"</p>
                </div>
            `;
            return;
        }

        resultsContainer.innerHTML = results.map(r => `
            <div onclick="AppLogic.showStatement('${r.type}', ${r.id});" 
                class="flex items-center justify-between p-4 bg-slate-800/50 hover:bg-slate-800 rounded-xl cursor-pointer transition-all group">
                <div class="flex items-center space-x-4">
                    <div class="w-10 h-10 rounded-full bg-sky-500/20 flex items-center justify-center text-sky-400 group-hover:bg-sky-500/30 transition-all">
                        <i class="fas ${r.icon}"></i>
                    </div>
                    <div>
                        <div class="font-semibold text-slate-100">${r.name}</div>
                        <div class="text-xs text-slate-500">${r.subtitle}</div>
                    </div>
                </div>
                <div class="text-right">
                    <div class="font-bold ${r.balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
                        ${r.balance.toFixed(3)} KD
                    </div>
                    <div class="text-xs text-slate-500">View Statement →</div>
                </div>
            </div>
        `).join('');
    },

    exportStatementToExcel(type, id, startStr, endStr) {
        const item = Store.data[type + 's'].find(i => i.id == id);

        // Use provided dates or default to current month
        const now = new Date();
        if (!startStr) {
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            startStr = firstDay.toISOString().split('T')[0];
        }
        if (!endStr) {
            endStr = now.toISOString().split('T')[0];
        }

        const allRelevantTxs = Store.data.transactions.filter(t =>
            (type === 'account' && (t.accountId == id || t.toId == id)) ||
            (type === 'ledger' && (t.ledgerId == id || t.accountId == id || t.toId == id))
        ).sort((a, b) => a.id - b.id);

        // 1. Calculate Opening Balance for the period
        let periodOpeningBal = item.openingBalance || 0;
        const prePeriodTxs = allRelevantTxs.filter(t => t.date < startStr);

        prePeriodTxs.forEach(t => {
            let isIn = false, isOut = false;
            if (type === 'account') {
                isOut = (t.type === 'expense' && t.accountId == id) || (t.type === 'contra' && t.accountId == id);
                isIn = (t.type === 'income' && t.accountId == id) || (t.type === 'contra' && t.toId == id);
            } else {
                isOut = (t.type === 'expense' && t.ledgerId == id) || (t.type === 'contra' && t.toId == id);
                isIn = (t.type === 'income' && t.ledgerId == id) || (t.type === 'contra' && t.accountId == id);
            }

            if (isIn) {
                periodOpeningBal += (type === 'ledger' && item.groupId > 2) ? -t.amount : t.amount;
            }
            if (isOut) {
                periodOpeningBal += (type === 'ledger' && item.groupId > 2) ? t.amount : -t.amount;
            }
        });

        // 2. Filter Period Transactions
        const periodTxs = allRelevantTxs.filter(t => t.date >= startStr && t.date <= endStr);

        let csv = "Date,Related To,Remark,Paid (Out),Recv (In),Balance\n";

        // Opening Balance Row in CSV
        csv += `${startStr.split('-').reverse().join('/')},Opening Balance (B/F),Calculated Value before period,,,\"${periodOpeningBal.toFixed(3)}\"\n`;

        let runningBal = periodOpeningBal;
        periodTxs.forEach(t => {
            let isIn = false, isOut = false;
            if (type === 'account') {
                isOut = (t.type === 'expense' && t.accountId == id) || (t.type === 'contra' && t.accountId == id);
                isIn = (t.type === 'income' && t.accountId == id) || (t.type === 'contra' && t.toId == id);
            } else {
                isOut = (t.type === 'expense' && t.ledgerId == id) || (t.type === 'contra' && t.toId == id);
                isIn = (t.type === 'income' && t.ledgerId == id) || (t.type === 'contra' && t.accountId == id);
            }

            if (isIn) runningBal += (type === 'ledger' && item.groupId > 2) ? -t.amount : t.amount;
            if (isOut) runningBal += (type === 'ledger' && item.groupId > 2) ? t.amount : -t.amount;

            let relatedName = '-';
            if (type === 'account') {
                const led = Store.data.ledgers.find(l => l.id == t.ledgerId);
                if (led) relatedName = led.name;
                else if (t.type === 'contra') {
                    const otherAccId = t.accountId == id ? t.toId : t.accountId;
                    const otherAcc = Store.data.accounts.find(a => a.id == otherAccId);
                    relatedName = otherAcc ? `Trf: ${otherAcc.name}` : 'Transfer';
                }
            } else {
                const acc = Store.data.accounts.find(a => a.id == t.accountId);
                if (acc) relatedName = acc.name;
                else if (t.type === 'contra') {
                    const otherId = t.accountId == id ? t.toId : t.accountId;
                    const other = Store.data.accounts.find(a => a.id == otherId) || Store.data.ledgers.find(l => l.id == otherId);
                    relatedName = other ? `Trf: ${other.name}` : 'Transfer';
                }
            }

            const row = [
                t.date.split('-').reverse().join('/'),
                `\"${relatedName}\"`,
                `\"${t.remark || ''}\"`,
                isOut ? t.amount.toFixed(3) : '0.000',
                isIn ? t.amount.toFixed(3) : '0.000',
                `\"${runningBal.toFixed(3)}\"`
            ];
            csv += row.join(',') + "\n";
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `${item.name}_Statement_${startStr}_to_${endStr}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    // --- LOAN PORTFOLIO LOGIC ---
    loanFilterStatus: 'active',
    loanCategoryFilter: 'personal',

    toggleLoanCategory(category) {
        this.loanCategoryFilter = category;
        const personalBtn = document.getElementById('cat-personal');
        const willtecBtn = document.getElementById('cat-willtec');

        if (category === 'personal') {
            personalBtn.className = 'px-6 py-2 rounded-xl text-sm font-bold transition-all bg-sky-500 text-slate-950';
            willtecBtn.className = 'px-6 py-2 rounded-xl text-sm font-bold transition-all text-slate-400 hover:text-slate-100';
        } else {
            willtecBtn.className = 'px-6 py-2 rounded-xl text-sm font-bold transition-all bg-sky-500 text-slate-950';
            personalBtn.className = 'px-6 py-2 rounded-xl text-sm font-bold transition-all text-slate-400 hover:text-slate-100';
        }
        this.renderLoans();
    },

    toggleLoanFilter(status) {
        this.loanFilterStatus = status;
        const activeBtn = document.getElementById('toggle-active-loans');
        const closedBtn = document.getElementById('toggle-closed-loans');

        if (status === 'active') {
            activeBtn.className = 'px-4 py-1.5 rounded-lg text-xs font-bold transition-all bg-sky-500 text-slate-950';
            closedBtn.className = 'px-4 py-1.5 rounded-lg text-xs font-bold transition-all text-slate-400 hover:text-slate-100';
        } else {
            closedBtn.className = 'px-4 py-1.5 rounded-lg text-xs font-bold transition-all bg-sky-500 text-slate-950';
            activeBtn.className = 'px-4 py-1.5 rounded-lg text-xs font-bold transition-all text-slate-400 hover:text-slate-100';
        }
        this.renderLoans();
    },

    formatCurrency(amount, code) {
        const locale = code === 'INR' ? 'en-IN' : 'en-KW';
        const decimals = code === 'KWD' ? 3 : 2;
        return new Intl.NumberFormat(locale, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(amount);
    },

    calculateLoanMetrics(loan) {
        const principal = parseFloat(loan.principal) || 0;
        const rate = parseFloat(loan.interest_rate) || 0;
        const monthlyTotalInterest = (principal * rate) / 100;

        let renjuShare, partnerShare;
        
        if (loan.category === 'will_tec') {
            renjuShare = 0;
            partnerShare = monthlyTotalInterest;
        } else {
            renjuShare = monthlyTotalInterest * ((loan.my_share_pct || 25) / 100);
            partnerShare = monthlyTotalInterest * ((loan.partner_share_pct || 75) / 100);
        }

        return {
            monthlyTotalInterest,
            renjuShare,
            partner_share: partnerShare
        };
    },

    getNextInterestDate(loan) {
        if (!loan.created_at) return null;
        const startDate = new Date(loan.created_at);
        const startDay = startDate.getDate();
        const now = new Date();
        let nextDate = new Date(now.getFullYear(), now.getMonth(), startDay);

        // If the date for this month has already passed, set it for next month
        if (nextDate < now) {
            nextDate = new Date(now.getFullYear(), now.getMonth() + 1, startDay);
        }
        return nextDate;
    },

    renderLoans() {
        const list = document.getElementById('loan-list');
        if (!list) return;

        const searchQuery = document.getElementById('loan-search')?.value.toLowerCase() || "";
        let loans = Store.data.loans || [];

        // Apply Active/Closed Filter
        loans = loans.filter(l => this.loanFilterStatus === 'active' ? l.is_active : !l.is_active);

        // Apply Category Filter (Default to personal for legacy)
        loans = loans.filter(l => (l.category || 'personal') === this.loanCategoryFilter);

        // Apply Search Filter
        if (searchQuery) {
            loans = loans.filter(l => l.end_user.toLowerCase().includes(searchQuery));
        }

        // Calculate Totals Row
        // Calculate Totals
        let kwdTotalPrincipal = 0;
        let kwdTotalInterest = 0;
        let kwdMyShare = 0;
        let kwdPartnerShare = 0;
        let inrTotalPrincipal = 0;
        let inrTotalInterest = 0;
        let inrMyShare = 0;
        let inrPartnerShare = 0;

        const activeLoans = Store.data.loans.filter(l => l.is_active && (l.category || 'personal') === this.loanCategoryFilter);
        activeLoans.forEach(l => {
            const metrics = this.calculateLoanMetrics(l);
            if (l.currency_code === 'KWD') {
                kwdTotalPrincipal += parseFloat(l.principal);
                kwdTotalInterest += metrics.monthlyTotalInterest;
                kwdMyShare += metrics.renjuShare;
                kwdPartnerShare += metrics.partner_share;
            } else {
                inrTotalPrincipal += parseFloat(l.principal);
                inrTotalInterest += metrics.monthlyTotalInterest;
                inrMyShare += metrics.renjuShare;
                inrPartnerShare += metrics.partner_share;
            }
        });

        // Update Totals UI
        document.getElementById('kwd-total-principal').textContent = this.formatCurrency(kwdTotalPrincipal, 'KWD');
        document.getElementById('kwd-total-interest').textContent = this.formatCurrency(kwdTotalInterest, 'KWD');
        document.getElementById('kwd-my-share').textContent = this.formatCurrency(kwdMyShare, 'KWD');
        document.getElementById('kwd-partner-share').textContent = this.formatCurrency(kwdPartnerShare, 'KWD');

        document.getElementById('inr-total-principal').textContent = this.formatCurrency(inrTotalPrincipal, 'INR');
        document.getElementById('inr-total-interest').textContent = this.formatCurrency(inrTotalInterest, 'INR');
        document.getElementById('inr-my-share').textContent = this.formatCurrency(inrMyShare, 'INR');
        document.getElementById('inr-partner-share').textContent = this.formatCurrency(inrPartnerShare, 'INR');

        // Dynamic Labels & Visibility
        const isWillTec = this.loanCategoryFilter === 'will_tec';
        document.getElementById('inr-portfolio-card').classList.toggle('hidden', isWillTec);
        
        const kwdMyLabel = document.getElementById('kwd-my-share-label');
        const kwdPartnerLabel = document.getElementById('kwd-partner-share-label');
        const inrMyLabel = document.getElementById('inr-my-share-label');
        const inrPartnerLabel = document.getElementById('inr-partner-share-label');

        if (isWillTec) {
            kwdMyLabel.parentElement.classList.add('hidden');
            kwdPartnerLabel.parentElement.classList.add('hidden');
            document.getElementById('will-tec-view-controls').classList.remove('hidden');
            
            // Populate Creditor Breakdown Table in KWD Card
            const breakdownContainer = document.getElementById('kwd-creditor-breakdown');
            const breakdownList = document.getElementById('creditor-breakdown-list');
            breakdownContainer.classList.remove('hidden');
            
            const grouped = this.getGroupedCreditorData(loans);
            breakdownList.innerHTML = grouped.map(g => `
                <div class="flex justify-between items-center text-[10px] py-1 border-b border-white/5 last:border-0 hover:bg-white/5 px-1 rounded transition-colors cursor-pointer" onclick="window.AppLogic.focusCreditor('${g.name}')">
                    <span class="text-slate-200 font-bold">${g.name}</span>
                    <div class="space-x-4">
                        <span class="text-slate-500">${this.formatCurrency(g.totalPrincipal, 'KWD')}</span>
                        <span class="text-emerald-400 font-bold">(${this.formatCurrency(g.totalInterest, 'KWD')})</span>
                    </div>
                </div>
            `).join('');
            
        } else {
            kwdMyLabel.parentElement.classList.remove('hidden');
            kwdPartnerLabel.parentElement.classList.remove('hidden');
            document.getElementById('will-tec-view-controls').classList.add('hidden');
            document.getElementById('kwd-creditor-breakdown').classList.add('hidden');
            
            kwdMyLabel.textContent = "My Share (25%)";
            kwdPartnerLabel.textContent = "Partner Share";
            inrMyLabel.textContent = "My Share (25%)";
            inrPartnerLabel.textContent = "Partner Share";
        }

        const listView = document.getElementById('loan-list');
        const summaryView = document.getElementById('loan-summary-view');

        // Calculate and Sort
        let overdueCount = 0;
        let upcomingCount = 0;
        let totalActiveCount = 0;

        const processedLoans = loans.map(l => {
            const p = this.getLoanPriorityData(l);
            if (l.is_active) {
                totalActiveCount++;
                if (p.status === 'OVERDUE') overdueCount++;
                if (p.status === 'UPCOMING') upcomingCount++;
            }
            return { ...l, priority: p };
        });

        // Sorting Logic
        processedLoans.sort((a, b) => {
            if (this.loanSortCriteria === 'priority') {
                if (a.priority.priority !== b.priority.priority) {
                    return a.priority.priority - b.priority.priority;
                }
                // Within the same priority, sub-sort
                if (a.priority.status === 'OVERDUE') return b.priority.days - a.priority.days; // Most overdue first
                if (a.priority.status === 'UPCOMING') return a.priority.days - b.priority.days; // Nearest due first
                return b.principal - a.principal; // Then highest principal
            } else if (this.loanSortCriteria === 'date') {
                return a.priority.nextDate - b.priority.nextDate;
            } else if (this.loanSortCriteria === 'amount') {
                return b.principal - a.principal;
            } else {
                return a.end_user.localeCompare(b.end_user);
            }
        });

        // Update Sticky Header
        const priorityHeader = document.getElementById('loan-priority-stats');
        if (priorityHeader) {
            priorityHeader.classList.remove('hidden');
            priorityHeader.innerHTML = `
                <div class="flex items-center space-x-2 ${overdueCount > 0 ? 'text-rose-500' : 'text-slate-500'}">
                    <span class="w-2 h-2 rounded-full bg-rose-500 ${overdueCount > 0 ? 'animate-pulse' : 'opacity-20'}"></span>
                    <span>${overdueCount} Overdue</span>
                </div>
                <div class="w-px h-4 bg-slate-800"></div>
                <div class="flex items-center space-x-2 ${upcomingCount > 0 ? 'text-amber-500' : 'text-slate-500'}">
                    <span class="w-2 h-2 rounded-full bg-amber-500"></span>
                    <span>${upcomingCount} Upcoming</span>
                </div>
                <div class="w-px h-4 bg-slate-800"></div>
                <div class="flex items-center space-x-2 text-sky-500">
                    <span class="w-2 h-2 rounded-full bg-sky-500"></span>
                    <span>${totalActiveCount} Total</span>
                </div>
            `;
        }

        if (isWillTec && this.willTecViewMode === 'summary') {
            listView.classList.add('hidden');
            summaryView.classList.remove('hidden');
            // When in summary mode, creditors should also be sorted by priority
            this.renderCreditorSummaryView(processedLoans);
            return;
        } else {
            listView.classList.remove('hidden');
            summaryView.classList.add('hidden');
        }

        if (processedLoans.length === 0) {
            list.innerHTML = `<div class="col-span-full text-center py-20 text-slate-500 italic">No ${this.loanFilterStatus} loans found</div>`;
            return;
        }

        list.innerHTML = processedLoans.map(l => {
            const p = l.priority;
            const metrics = this.calculateLoanMetrics(l);
            
            let priorityBadge = '';
            if (p.status === 'OVERDUE') {
                priorityBadge = `<div class="bg-rose-500 text-slate-950 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter animate-pulse-red mb-3">OVERDUE BY ${p.days} DAYS</div>`;
            } else if (p.status === 'UPCOMING') {
                priorityBadge = `<div class="bg-amber-500 text-slate-950 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter mb-3">DUE IN ${p.days} DAYS</div>`;
            }

            return `
                <div class="loan-card ${p.bg} border ${p.border} rounded-3xl p-6 flex flex-col justify-between group transition-all hover:scale-[1.02] relative overflow-hidden">
                    ${p.status === 'OVERDUE' ? '<div class="absolute top-0 right-0 w-16 h-16 bg-rose-500/10 blur-2xl rounded-full"></div>' : ''}
                    <div>
                        ${priorityBadge}
                        <div class="flex justify-between items-start mb-4">
                            <div>
                                <h3 class="text-xl font-bold text-slate-100">${l.end_user}</h3>
                                <div class="text-[10px] text-slate-500 uppercase tracking-widest mt-1">
                                    ${l.currency_code} Portfolio | ${l.category === 'will_tec' ? 'Creditor' : 'Personal'} | Received: ${new Date(l.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '/')}
                                </div>
                            </div>
                            <div class="px-3 py-1 rounded-full text-[10px] font-bold uppercase ${l.is_active ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}">
                                ${l.is_active ? 'Active' : 'Closed'}
                            </div>
                        </div>

                        <div class="space-y-3">
                            <div class="flex justify-between items-center">
                                <span class="text-xs text-slate-500">Principal</span>
                                <span class="font-orbitron font-bold text-slate-200">${this.formatCurrency(l.principal, l.currency_code)}</span>
                            </div>
                            <div class="flex justify-between items-center text-xs">
                                <span class="text-slate-500">Interest (${l.interest_rate}%)</span>
                                <span class="font-bold text-emerald-400">${this.formatCurrency(metrics.monthlyTotalInterest, l.currency_code)}</span>
                            </div>
                            ${l.category === 'will_tec' ? '' : `
                            <div class="flex justify-between items-center text-[10px] text-slate-400 px-2 py-1 bg-slate-800/20 rounded-lg border border-white/5">
                                <div class="flex flex-col">
                                    <span class="text-[8px] uppercase tracking-tighter opacity-50">My Share (${l.my_share_pct}%)</span>
                                    <span class="font-orbitron text-sky-400">${this.formatCurrency(metrics.renjuShare, l.currency_code)}</span>
                                </div>
                                <div class="flex flex-col text-right">
                                    <span class="text-[8px] uppercase tracking-tighter opacity-50">Partner (${l.partner_share_pct}%)</span>
                                    <span class="font-orbitron text-slate-300">${this.formatCurrency(metrics.partner_share, l.currency_code)}</span>
                                </div>
                            </div>
                            `}
                        </div>
                    </div>

                    <div class="mt-8 space-y-4 shadow-2xl p-4 bg-slate-950/20 rounded-2xl border border-white/5">
                        <div class="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-widest font-black">
                            <span>Next ${p.isPaid ? 'Payment' : 'Due At'}</span>
                            <span class="${p.color} font-orbitron">${p.nextDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '/')}</span>
                        </div>
                        
                        <div class="flex space-x-2">
                            ${l.is_active ? `
                                <button onclick="event.stopPropagation(); ${p.isPaid ? `window.AppLogic.handleUnmarkPaid('${l.id}')` : `window.AppLogic.handleMarkPaid('${l.id}')`}" 
                                    class="flex-1 py-1.5 rounded-xl font-bold text-xs transition-all ${p.isPaid ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'bg-sky-500 text-slate-950 shadow-lg shadow-sky-500/20 active:scale-95'}">
                                    ${p.isPaid ? '<i class="fas fa-undo mr-1"></i> Revert' : 'Mark Paid'}
                                </button>
                            ` : ''}
                            <button onclick="event.stopPropagation(); window.AppLogic.showLoanStatement('${l.id}')" class="p-2.5 rounded-xl bg-slate-800 text-slate-400 hover:text-emerald-400" title="View History">
                                <i class="fas fa-file-invoice-dollar"></i>
                            </button>
                            <button onclick="event.stopPropagation(); window.AppLogic.showEditLoanModal('${l.id}')" class="p-2.5 rounded-xl bg-slate-800 text-slate-400 hover:text-sky-400">
                                <i class="fas fa-edit"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    async handleMarkPaid(loanId) {
        const now = new Date();
        const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const success = await Store.markLoanPaid(loanId, monthYear);
        if (success) {
            Auth.showToast("Interest marked as paid");
            this.renderLoans();
        } else {
            Auth.showToast("Already paid for this month", "info");
        }
    },

    async handleDeleteLoan(loanId) {
        console.log("Attempting to delete loan:", loanId);
        if (window.confirm("Are you sure you want to delete this loan? This will also remove all payment records for this user.")) {
            await Store.deleteLoan(loanId);
            Auth.showToast("Loan Portfolio Deleted", "error");
            AppLogic.renderLoans();
        }
    },

    async handleUnmarkPaid(loanId) {
        const now = new Date();
        const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        if (confirm("Revert this month's payment to Unpaid?")) {
            await Store.unmarkLoanPaid(loanId, monthYear);
            Auth.showToast("Payment Reverted", "error");
            this.renderLoans();
        }
    },

    renderCreditorSummaryView(loans) {
        const container = document.getElementById('loan-summary-view');
        if (!container) return;

        const grouped = this.getGroupedCreditorData(loans);
        
        if (grouped.length === 0) {
            container.innerHTML = `<div class="text-center py-20 text-slate-500 italic">No summary data available</div>`;
            return;
        }

        let html = `
            <div class="overflow-x-auto bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl">
                <table class="w-full text-left">
                    <thead>
                        <tr class="text-[10px] uppercase tracking-widest text-slate-500 border-b border-white/5">
                            <th class="pb-4 pl-4">Creditor Name</th>
                            <th class="pb-4">Loans</th>
                            <th class="pb-4">Total Principal</th>
                            <th class="pb-4 text-emerald-400">Monthly Int.</th>
                            <th class="pb-4 text-right pr-4">Latest Date</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-white/5">
        `;

        grouped.forEach(g => {
            const dateStr = g.latestDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '/');
            
            let statusBadge = '';
            let rowBg = '';
            if (g.maxPriority === 1) {
                statusBadge = '<span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse mr-2"></span>';
                rowBg = 'bg-rose-500/5';
            } else if (g.maxPriority === 2) {
                statusBadge = '<span class="w-2 h-2 rounded-full bg-amber-500 mr-2"></span>';
                rowBg = 'bg-amber-500/5';
            }

            html += `
                <tr class="group hover:bg-white/10 transition-all cursor-pointer ${rowBg}" onclick="this.nextElementSibling.classList.toggle('hidden')">
                    <td class="py-5 pl-4 flex items-center space-x-3">
                        ${statusBadge}
                        <div class="w-8 h-8 rounded-full bg-sky-500/10 flex items-center justify-center text-sky-400 font-bold text-xs uppercase">
                            ${g.name.charAt(0)}
                        </div>
                        <span class="font-bold text-slate-200">${g.name}</span>
                    </td>
                    <td class="py-5">
                        <span class="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-bold">${g.loans.length} Loans</span>
                    </td>
                    <td class="py-5 font-orbitron font-bold text-slate-200">
                        ${this.formatCurrency(g.totalPrincipal, 'KWD')}
                    </td>
                    <td class="py-5 font-orbitron font-bold text-emerald-400">
                        ${this.formatCurrency(g.totalInterest, 'KWD')}
                    </td>
                    <td class="py-5 text-right pr-4 text-xs font-orbitron text-slate-500">
                        ${dateStr}
                    </td>
                </tr>
                <tr class="hidden bg-slate-950/50">
                    <td colspan="5" class="p-6">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            ${g.loans.map(l => {
                                const metrics = this.calculateLoanMetrics(l);
                                const isPaid = Store.data.loanPayments.some(p => p.loan_id === l.id && p.month_year === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`);
                                return `
                                    <div class="p-4 rounded-2xl border border-slate-800 bg-slate-900 shadow-lg flex justify-between items-center group/card">
                                        <div>
                                            <div class="text-[10px] text-slate-500 uppercase font-black">${new Date(l.created_at).toLocaleDateString()}</div>
                                            <div class="font-bold text-slate-200">${this.formatCurrency(l.principal, l.currency_code)} @ ${l.interest_rate}%</div>
                                            <div class="text-emerald-400 font-bold text-xs">${this.formatCurrency(metrics.monthlyTotalInterest, l.currency_code)} / mo</div>
                                        </div>
                                        <div class="flex space-x-1">
                                            <button onclick="event.stopPropagation(); window.AppLogic.showLoanStatement('${l.id}')" class="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-emerald-400"><i class="fas fa-file-invoice-dollar text-xs"></i></button>
                                            <button onclick="event.stopPropagation(); window.AppLogic.showEditLoanModal('${l.id}')" class="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-sky-400"><i class="fas fa-edit text-xs"></i></button>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                        <div class="mt-4 flex justify-end">
                            <button onclick="window.AppLogic.focusCreditor('${g.name}')" class="text-[10px] text-sky-400 hover:text-sky-300 font-bold uppercase tracking-widest border-b border-sky-400/30">View detailed list &rarr;</button>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;
    },

    focusCreditor(name) {
        document.getElementById('loan-search').value = name;
        this.willTecViewMode = 'list';
        this.toggleWillTecViewMode('list');
    },

    showAddLoanModal() {
        const html = `
            <div id="modal-content" class="bg-slate-900 w-full max-w-lg rounded-t-3xl md:rounded-3xl p-8 space-y-6 shadow-2xl border-t border-slate-800 animate-fade-in max-h-[90vh] overflow-y-auto">
                <div class="flex items-center justify-between">
                    <h3 class="text-xl font-bold font-orbitron text-emerald-400">New Loan Portfolio</h3>
                    <button onclick="document.getElementById('modal-container').classList.add('hidden')" class="text-slate-500 hover:text-slate-300"><i class="fas fa-times text-xl"></i></button>
                </div>
                
                <form id="add-loan-form" class="space-y-4">
                    <div class="space-y-1">
                        <label id="loan-user-label" class="text-xs text-slate-500 ml-1 uppercase tracking-widest font-bold">End User Name</label>
                        <input type="text" id="loan-user" placeholder="e.g. Subin" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-lg" required>
                    </div>
                    
                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1 uppercase tracking-widest font-bold">Loan Category</label>
                        <select id="loan-category" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500" onchange="window.AppLogic.onLoanCategoryChange()">
                            <option value="personal">Personal Loan</option>
                            <option value="will_tec">Will Tec Loan</option>
                        </select>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1" id="currency-field-container">
                            <label class="text-xs text-slate-500 ml-1 uppercase tracking-widest font-bold">Currency</label>
                            <select id="loan-currency" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500">
                                <option value="KWD">KWD (KD)</option>
                                <option value="INR">INR (₹)</option>
                            </select>
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs text-slate-500 ml-1 uppercase tracking-widest font-bold">Interest Rate (%)</label>
                            <input type="number" step="0.01" id="loan-rate" value="1.00" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-orbitron" required>
                        </div>
                    </div>

                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1 uppercase tracking-widest font-bold">Principal Amount</label>
                        <input type="number" step="0.001" id="loan-principal" placeholder="0.000" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-orbitron text-xl text-emerald-400" required>
                    </div>

                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1 uppercase tracking-widest font-bold">Received Date</label>
                        <input type="date" id="loan-date" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-orbitron text-slate-100" required>
                    </div>

                    <div id="share-split-container" class="p-4 bg-slate-950/50 rounded-2xl border border-slate-800 space-y-4">
                        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
                            <span class="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Split Interest By</span>
                            <div class="flex bg-slate-900 p-1 rounded-lg">
                                <button type="button" id="mode-pct" onclick="window.AppLogic.toggleShareMode('pct')" class="px-3 py-1 text-[10px] font-bold rounded-md bg-sky-500 text-slate-950 transition-all">Percentage</button>
                                <button type="button" id="mode-amt" onclick="window.AppLogic.toggleShareMode('amt')" class="px-3 py-1 text-[10px] font-bold rounded-md text-slate-400 hover:text-slate-100 transition-all">Amount</button>
                            </div>
                        </div>

                        <!-- Percentage Inputs -->
                        <div id="share-pct-inputs" class="grid grid-cols-2 gap-4">
                            <div class="space-y-1">
                                <label class="text-[10px] text-slate-500 uppercase tracking-widest">My Share %</label>
                                <input type="number" id="loan-my-share-pct" value="25" class="w-full bg-transparent border-none p-0 focus:outline-none font-orbitron text-sky-400">
                            </div>
                            <div class="space-y-1 text-right">
                                <label class="text-[10px] text-slate-500 uppercase tracking-widest">Partner Share %</label>
                                <input type="number" id="loan-partner-share-pct" value="75" class="w-full bg-transparent border-none p-0 focus:outline-none font-orbitron text-slate-400 text-right">
                            </div>
                        </div>

                        <!-- Amount Inputs (Hidden by default) -->
                        <div id="share-amt-inputs" class="grid grid-cols-2 gap-4 hidden">
                            <div class="space-y-1 border-r border-slate-800 pr-4">
                                <label class="text-[10px] text-slate-500 uppercase tracking-widest">My Amount</label>
                                <input type="number" step="0.001" id="loan-my-amt" placeholder="0.000" oninput="window.AppLogic.calculateFromAmounts()" class="w-full bg-transparent border-none p-0 focus:outline-none font-orbitron text-sky-400">
                            </div>
                            <div class="space-y-1 pl-4 text-right">
                                <label class="text-[10px] text-slate-500 uppercase tracking-widest">Partner Amount</label>
                                <input type="number" step="0.001" id="loan-partner-amt" placeholder="0.000" oninput="window.AppLogic.calculateFromAmounts()" class="w-full bg-transparent border-none p-0 focus:outline-none font-orbitron text-slate-400 text-right">
                            </div>
                        </div>
                    </div>

                    <div class="flex space-x-3 pt-4">
                        <button type="button" onclick="document.getElementById('modal-container').classList.add('hidden')" class="flex-1 bg-slate-800 text-slate-400 py-4 rounded-xl font-bold hover:bg-slate-700 transition-all">Cancel</button>
                        <button type="submit" class="flex-1 bg-emerald-500 text-slate-950 py-4 rounded-xl font-bold shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 active:scale-95 transition-all">Create Loan</button>
                    </div>
                </form>
            </div>
        `;

        this.modalContainer.innerHTML = html;
        this.modalContainer.classList.remove('hidden');

        // Set default date to today
        document.getElementById('loan-date').valueAsDate = new Date();

        document.getElementById('add-loan-form').onsubmit = async (e) => {
            e.preventDefault();
            const loan = {
                end_user: document.getElementById('loan-user').value,
                category: document.getElementById('loan-category').value,
                currency_code: document.getElementById('loan-currency').value,
                principal: parseFloat(document.getElementById('loan-principal').value),
                interest_rate: parseFloat(document.getElementById('loan-rate').value),
                my_share_pct: parseFloat(document.getElementById('loan-my-share-pct').value),
                partner_share_pct: parseFloat(document.getElementById('loan-partner-share-pct').value),
                is_active: true,
                created_at: new Date(document.getElementById('loan-date').value).toISOString()
            };

            await Store.addLoan(loan);
            this.modalContainer.classList.add('hidden');
            Auth.showToast("New Loan Added");
            this.renderLoans();
        };

        // Initial category state handling
        this.onLoanCategoryChange();
    },

    showEditLoanModal(loanId) {
        const l = Store.data.loans.find(loan => loan.id === loanId);
        if (!l) return;

        const metrics = this.calculateLoanMetrics(l);

        const html = `
            <div id="modal-content" class="bg-slate-900 w-full max-w-lg rounded-t-3xl md:rounded-3xl p-8 space-y-6 shadow-2xl border-t border-slate-800 animate-fade-in max-h-[90vh] overflow-y-auto">
                <div class="flex items-center justify-between">
                    <h3 class="text-xl font-bold font-orbitron text-sky-400">Edit Loan Portfolio</h3>
                    <button onclick="document.getElementById('modal-container').classList.add('hidden')" class="text-slate-500 hover:text-slate-300"><i class="fas fa-times text-xl"></i></button>
                </div>
                
                <form id="edit-loan-form" class="space-y-4">
                    <div class="space-y-1">
                        <label id="edit-loan-user-label" class="text-xs text-slate-500 ml-1 uppercase tracking-widest font-bold">End User Name</label>
                        <input type="text" id="edit-loan-user" value="${l.end_user}" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-sky-500 text-lg" required>
                    </div>
                    
                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1 uppercase tracking-widest font-bold">Loan Category</label>
                        <select id="edit-loan-category" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-sky-500" onchange="window.AppLogic.onLoanCategoryChange(true)">
                            <option value="personal" ${l.category === 'personal' || !l.category ? 'selected' : ''}>Personal Loan</option>
                            <option value="will_tec" ${l.category === 'will_tec' ? 'selected' : ''}>Will Tec Loan</option>
                        </select>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1" id="edit-currency-field-container">
                            <label class="text-xs text-slate-500 ml-1 uppercase tracking-widest font-bold">Currency</label>
                            <select id="edit-loan-currency" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-sky-500">
                                <option value="KWD" ${l.currency_code === 'KWD' ? 'selected' : ''}>KWD (KD)</option>
                                <option value="INR" ${l.currency_code === 'INR' ? 'selected' : ''}>INR (₹)</option>
                            </select>
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs text-slate-500 ml-1 uppercase tracking-widest font-bold">Status</label>
                            <select id="edit-loan-status" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-sky-500">
                                <option value="active" ${l.is_active ? 'selected' : ''}>Active</option>
                                <option value="closed" ${!l.is_active ? 'selected' : ''}>Closed / Settled</option>
                            </select>
                        </div>
                    </div>

                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1 uppercase tracking-widest font-bold">Interest Rate (%)</label>
                        <input type="number" step="0.01" id="edit-loan-rate" value="${l.interest_rate}" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-sky-500 font-orbitron" required>
                    </div>

                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1 uppercase tracking-widest font-bold">Principal Amount</label>
                        <input type="number" step="0.001" id="edit-loan-principal" value="${l.principal}" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-sky-500 font-orbitron text-xl text-sky-400" required>
                    </div>

                    <div class="space-y-1">
                        <label class="text-xs text-slate-500 ml-1 uppercase tracking-widest font-bold">Received Date</label>
                        <input type="date" id="edit-loan-date" value="${new Date(l.created_at).toISOString().split('T')[0]}" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-sky-500 font-orbitron text-slate-100" required>
                    </div>

                    <div id="edit-share-split-container" class="p-4 bg-slate-950/50 rounded-2xl border border-slate-800 space-y-4">
                        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
                            <span class="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Split Interest By</span>
                            <div class="flex bg-slate-900 p-1 rounded-lg">
                                <button type="button" id="edit-mode-pct" onclick="window.AppLogic.toggleShareMode('pct', true)" class="px-3 py-1 text-[10px] font-bold rounded-md bg-sky-500 text-slate-950 transition-all">Percentage</button>
                                <button type="button" id="edit-mode-amt" onclick="window.AppLogic.toggleShareMode('amt', true)" class="px-3 py-1 text-[10px] font-bold rounded-md text-slate-400 hover:text-slate-100 transition-all">Amount</button>
                            </div>
                        </div>

                        <!-- Percentage Inputs -->
                        <div id="edit-share-pct-inputs" class="grid grid-cols-2 gap-4">
                            <div class="space-y-1">
                                <label class="text-[10px] text-slate-500 uppercase tracking-widest">My Share %</label>
                                <input type="number" id="edit-loan-my-share-pct" value="${l.my_share_pct || 25}" class="w-full bg-transparent border-none p-0 focus:outline-none font-orbitron text-sky-400">
                            </div>
                            <div class="space-y-1 text-right">
                                <label class="text-[10px] text-slate-500 uppercase tracking-widest">Partner Share %</label>
                                <input type="number" id="edit-loan-partner-share-pct" value="${l.partner_share_pct || 75}" class="w-full bg-transparent border-none p-0 focus:outline-none font-orbitron text-slate-400 text-right">
                            </div>
                        </div>

                        <!-- Amount Inputs (Hidden by default) -->
                        <div id="edit-share-amt-inputs" class="grid grid-cols-2 gap-4 hidden">
                            <div class="space-y-1 border-r border-slate-800 pr-4">
                                <label class="text-[10px] text-slate-500 uppercase tracking-widest">My Amount</label>
                                <input type="number" step="0.001" id="edit-loan-my-amt" value="${(metrics.renjuShare).toFixed(3)}" oninput="window.AppLogic.calculateFromAmounts(true)" class="w-full bg-transparent border-none p-0 focus:outline-none font-orbitron text-sky-400">
                            </div>
                            <div class="space-y-1 pl-4 text-right">
                                <label class="text-[10px] text-slate-500 uppercase tracking-widest">Partner Amount</label>
                                <input type="number" step="0.001" id="edit-loan-partner-amt" value="${(metrics.partner_share).toFixed(3)}" oninput="window.AppLogic.calculateFromAmounts(true)" class="w-full bg-transparent border-none p-0 focus:outline-none font-orbitron text-slate-400 text-right">
                            </div>
                        </div>
                    </div>

                    <div class="flex space-x-3 pt-4">
                        <button type="button" onclick="document.getElementById('modal-container').classList.add('hidden')" class="flex-1 bg-slate-800 text-slate-400 py-4 rounded-xl font-bold hover:bg-slate-700 transition-all">Cancel</button>
                        <button type="submit" class="flex-1 bg-sky-500 text-slate-950 py-4 rounded-xl font-bold shadow-lg shadow-sky-500/20 hover:bg-sky-400 active:scale-95 transition-all">Save Changes</button>
                    </div>
                </form>
            </div>
        `;

        this.modalContainer.innerHTML = html;
        this.modalContainer.classList.remove('hidden');

        // Initial category state handling
        this.onLoanCategoryChange(true);

        document.getElementById('edit-loan-form').onsubmit = async (e) => {
            e.preventDefault();
            const updated = {
                end_user: document.getElementById('edit-loan-user').value,
                category: document.getElementById('edit-loan-category').value,
                currency_code: document.getElementById('edit-loan-currency').value,
                is_active: document.getElementById('edit-loan-status').value === 'active',
                principal: parseFloat(document.getElementById('edit-loan-principal').value),
                interest_rate: parseFloat(document.getElementById('edit-loan-rate').value),
                my_share_pct: parseFloat(document.getElementById('edit-loan-my-share-pct').value),
                partner_share_pct: parseFloat(document.getElementById('edit-loan-partner-share-pct').value),
                created_at: new Date(document.getElementById('edit-loan-date').value).toISOString()
            };

            await Store.updateLoan(loanId, updated);
            this.modalContainer.classList.add('hidden');
            Auth.showToast("Loan Updated");
            this.renderLoans();
        };
    },

    toggleShareMode(mode, isEdit = false) {
        const prefix = isEdit ? 'edit-' : '';
        const pctBtn = document.getElementById(prefix + 'mode-pct');
        const amtBtn = document.getElementById(prefix + 'mode-amt');
        const pctContainer = document.getElementById(prefix + 'share-pct-inputs');
        const amtContainer = document.getElementById(prefix + 'share-amt-inputs');

        if (mode === 'pct') {
            pctBtn.classList.add('bg-sky-500', 'text-slate-950');
            pctBtn.classList.remove('text-slate-400');
            amtBtn.classList.add('text-slate-400');
            amtBtn.classList.remove('bg-sky-500', 'text-slate-950');
            pctContainer.classList.remove('hidden');
            amtContainer.classList.add('hidden');
        } else {
            amtBtn.classList.add('bg-sky-500', 'text-slate-950');
            amtBtn.classList.remove('text-slate-400');
            pctBtn.classList.add('text-slate-400');
            pctBtn.classList.remove('bg-sky-500', 'text-slate-950');
            amtContainer.classList.remove('hidden');
            pctContainer.classList.add('hidden');
        }
    },

    calculateFromAmounts(isEdit = false) {
        const prefix = isEdit ? 'edit-' : '';
        const principal = parseFloat(document.getElementById(prefix + 'loan-principal')?.value || document.getElementById('loan-principal')?.value);
        const myAmt = parseFloat(document.getElementById(prefix + 'loan-my-amt').value || 0);
        const partnerAmt = parseFloat(document.getElementById(prefix + 'loan-partner-amt').value || 0);

        if (principal && (myAmt || partnerAmt)) {
            const totalInterest = myAmt + partnerAmt;
            const rate = (totalInterest / principal) * 100;
            const myPct = (myAmt / totalInterest) * 100;
            const partnerPct = (partnerAmt / totalInterest) * 100;

            document.getElementById(prefix + 'loan-rate').value = rate.toFixed(4);
            document.getElementById(prefix + 'loan-my-share-pct').value = myPct.toFixed(4);
            document.getElementById(prefix + 'loan-partner-share-pct').value = partnerPct.toFixed(4);
        }
    },

    renderRemindersWidget() {
        const container = document.getElementById('loan-reminders-container');
        if (!container) return;

        const now = new Date();
        const activeLoans = Store.data.loans.filter(l => l.is_active);
        
        const overdue = [];
        const upcoming = [];

        activeLoans.forEach(l => {
            const startDate = new Date(l.created_at);
            const dueDay = startDate.getDate();
            const todayDay = now.getDate();
            
            // Consider only the current month (ignore historical backlog)
            const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const isPaid = Store.data.loanPayments.some(p => p.loan_id === l.id && p.month_year === monthYear);
            
            if (!isPaid) {
                const isTodayOverdue = todayDay > dueDay;
                
                if (isTodayOverdue) {
                    overdue.push({
                        name: l.end_user,
                        date: `${dueDay} ${now.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}`
                    });
                } else {
                    const daysUntil = dueDay - todayDay;
                    // User Requirement: Show upcoming payments before 2 days (<= 2 days away)
                    if (daysUntil >= 0 && daysUntil <= 2) {
                        upcoming.push({
                            name: l.end_user,
                            date: `${dueDay} ${now.toLocaleDateString('en-US', { month: 'short' })}`,
                            daysUntil
                        });
                    }
                }
            }
        });

        if (overdue.length === 0 && upcoming.length === 0) {
            container.innerHTML = '';
            container.classList.add('hidden');
            return;
        }

        container.classList.remove('hidden');

        // User Requirement: Show only 2 upcoming payments
        const limitedUpcoming = upcoming.sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 2);

        let html = `<div class="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in mb-6">`;

        // 1. Overdue Section
        if (overdue.length > 0) {
            html += `
                <div class="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex flex-col space-y-3">
                    <div class="flex items-center space-x-2 text-rose-500">
                        <i class="fas fa-exclamation-circle text-sm"></i>
                        <span class="text-[10px] uppercase font-black tracking-widest">Overdue Payments</span>
                    </div>
                    <div class="space-y-2 max-h-32 overflow-y-auto no-scrollbar">
                        ${overdue.map(o => `
                            <div class="flex justify-between items-center text-sm py-1 border-b border-rose-500/10 last:border-0">
                                <span class="font-bold text-rose-200">${o.name}</span>
                                <span class="text-[10px] font-orbitron text-rose-400/70">${o.date}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // 2. Upcoming Section (Limited to 2)
        if (limitedUpcoming.length > 0) {
            html += `
                <div class="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex flex-col space-y-3">
                    <div class="flex items-center space-x-2 text-amber-500">
                        <i class="fas fa-clock text-sm"></i>
                        <span class="text-[10px] uppercase font-black tracking-widest">Upcoming Interest (Next 2 Days)</span>
                    </div>
                    <div class="space-y-2">
                        ${limitedUpcoming.map(u => `
                            <div class="flex justify-between items-center text-sm py-1 border-b border-amber-500/10 last:border-0">
                                <span class="font-bold text-amber-100">${u.name}</span>
                                <span class="text-[10px] font-orbitron text-amber-400/80">${u.date}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        html += `</div>`;
        container.innerHTML = html;
    },

    async handleQuickCollect(loanId) {
        const l = Store.data.loans.find(loan => loan.id === loanId);
        if (!l) return;

        // Find oldest unpaid month
        const now = new Date();
        const startDate = new Date(l.created_at);
        let iter = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        
        let oldestUnpaid = null;
        while (iter <= currentMonthStart) {
            const monthYear = `${iter.getFullYear()}-${String(iter.getMonth() + 1).padStart(2, '0')}`;
            const isPaid = Store.data.loanPayments.some(p => p.loan_id === l.id && p.month_year === monthYear);
            if (!isPaid) {
                oldestUnpaid = monthYear;
                break;
            }
            iter.setMonth(iter.setMonth() + 1);
        }

        if (oldestUnpaid) {
            const monthText = new Date(oldestUnpaid + "-01").toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            if (confirm(`Collect interest for ${l.end_user} - ${monthText}?`)) {
                await Store.markLoanPaid(loanId, oldestUnpaid);
                Auth.showToast(`Collected: ${monthText}`);
                this.renderLoans();
            }
        }
    },

    showLoanStatement(loanId) {
        const loan = Store.data.loans.find(l => l.id === loanId);
        if (!loan) return;

        const payments = Store.data.loanPayments
            .filter(p => p.loan_id === loanId)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        const metrics = this.calculateLoanMetrics(loan);

        const html = `
            <div id="modal-content" class="bg-slate-950 w-full max-w-2xl rounded-t-3xl md:rounded-3xl shadow-2xl border border-slate-800 animate-fade-in flex flex-col max-h-[90vh]">
                <!-- Header -->
                <div class="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
                    <div>
                        <h3 class="text-2xl font-bold font-orbitron text-sky-400">${loan.end_user}</h3>
                        <p class="text-xs text-slate-500 uppercase tracking-widest">Loan Summary Statement</p>
                    </div>
                    <button onclick="document.getElementById('modal-container').classList.add('hidden')" class="text-slate-500 hover:text-slate-300">
                        <i class="fas fa-times text-xl"></i>
                    </button>
                </div>

                <!-- Info Grid -->
                <div class="grid grid-cols-2 lg:grid-cols-5 gap-4 p-6 bg-slate-900/30">
                    <div class="space-y-1">
                        <span class="text-[10px] text-slate-500 uppercase tracking-widest">Initial Date</span>
                        <div class="font-orbitron font-bold text-slate-100">${new Date(loan.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '/')}</div>
                    </div>
                    <div class="space-y-1">
                        <span class="text-[10px] text-slate-500 uppercase tracking-widest">Principal</span>
                        <div class="font-orbitron font-bold text-slate-100">${this.formatCurrency(loan.principal, loan.currency_code)}</div>
                    </div>
                    <div class="space-y-1">
                        <span class="text-[10px] text-slate-500 uppercase tracking-widest">Tot. Monthly Int (${loan.interest_rate}%)</span>
                        <div class="font-orbitron font-bold text-emerald-400">${this.formatCurrency(metrics.monthlyTotalInterest, loan.currency_code)}</div>
                    </div>
                    ${loan.category === 'will_tec' ? '' : `
                    <div class="space-y-1">
                        <span class="text-[10px] text-slate-500 uppercase tracking-widest">My Share (${loan.my_share_pct}%)</span>
                        <div class="font-orbitron font-bold text-sky-400">${this.formatCurrency(metrics.renjuShare, loan.currency_code)}</div>
                    </div>
                    <div class="space-y-1">
                        <span class="text-[10px] text-slate-500 uppercase tracking-widest">Partner Share (${loan.partner_share_pct}%)</span>
                        <div class="font-orbitron font-bold text-slate-400">${this.formatCurrency(metrics.partner_share, loan.currency_code)}</div>
                    </div>
                    `}
                </div>

                <!-- History List -->
                <div class="flex-1 overflow-y-auto p-6 space-y-4">
                    <h4 class="text-xs font-bold text-slate-100 uppercase tracking-widest mb-2 border-b border-slate-800 pb-2">Interest Payment History</h4>
                    
                    ${payments.length === 0 ? `
                        <div class="text-center py-10 text-slate-500 italic">No payments recorded yet.</div>
                    ` : payments.map(p => {
                        const paidDate = new Date(p.created_at);
                        const monthName = new Date(p.month_year + "-01").toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                        
                        return `
                            <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between group">
                                <div class="flex items-center space-x-4">
                                    <div class="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                                        <i class="fas fa-check-double text-sm"></i>
                                    </div>
                                    <div>
                                        <div class="font-bold text-slate-200">${monthName} Interest</div>
                                        <div class="text-[10px] text-slate-500">Paid on ${paidDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '/')} at ${paidDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                    </div>
                                </div>
                                <div class="text-right">
                                    <div class="font-orbitron font-bold text-emerald-400">+${this.formatCurrency(metrics.monthlyTotalInterest, loan.currency_code)}</div>
                                    <div class="text-[9px] text-slate-500 uppercase tracking-tighter">Status: Handed Over</div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>

                <!-- Footer Action -->
                <div class="p-6 border-t border-slate-800 bg-slate-900/50 flex justify-end">
                    <button onclick="window.print()" class="bg-slate-800 text-slate-300 px-6 py-2 rounded-xl text-xs font-bold hover:bg-slate-700 transition-all flex items-center space-x-2">
                        <i class="fas fa-print"></i> <span>Print Statement</span>
                    </button>
                </div>
            </div>
        `;

        this.modalContainer.innerHTML = html;
        this.modalContainer.classList.remove('hidden');
    },

    handleLoanSort(criteria) {
        this.loanSortCriteria = criteria;
        this.renderLoans();
    },

    getLoanPriorityData(l) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        
        const startDate = new Date(l.created_at);
        const dueDay = startDate.getDate();
        const currentMonthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const isPaid = Store.data.loanPayments.some(p => p.loan_id === l.id && p.month_year === currentMonthYear);
        
        let nextDate = new Date(now.getFullYear(), now.getMonth(), dueDay);
        if (isPaid || nextDate < now) {
            // If already paid this month OR the date has passed (and we are assessing for next month/overdue)
            if (isPaid) {
                nextDate = new Date(now.getFullYear(), now.getMonth() + 1, dueDay);
            }
        }

        const diffTime = nextDate - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (!l.is_active) {
            return { status: 'CLOSED', priority: 4, days: 0, nextDate, isPaid: true, color: 'text-slate-500', border: 'border-slate-800', bg: 'bg-slate-900/40' };
        }

        if (!isPaid && nextDate < now) {
            const overdueDays = Math.floor((now - nextDate) / (1000 * 60 * 60 * 24));
            return { status: 'OVERDUE', priority: 1, days: overdueDays, nextDate, isPaid: false, color: 'text-rose-500', border: 'border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.3)]', bg: 'bg-rose-500/5' };
        }

        if (!isPaid && diffDays <= 7) {
            return { status: 'UPCOMING', priority: 2, days: diffDays, nextDate, isPaid: false, color: 'text-amber-500', border: 'border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]', bg: 'bg-amber-500/5' };
        }

        return { status: 'NORMAL', priority: 3, days: diffDays, nextDate, isPaid, color: 'text-sky-500', border: 'border-slate-800', bg: 'bg-slate-900' };
    },

    toggleWillTecViewMode(mode) {
        this.willTecViewMode = mode;
        const listBtn = document.getElementById('view-mode-list');
        const summaryBtn = document.getElementById('view-mode-summary');

        if (mode === 'list') {
            listBtn.className = 'px-4 py-1.5 rounded-lg text-xs font-bold transition-all bg-sky-500 text-slate-950';
            summaryBtn.className = 'px-4 py-1.5 rounded-lg text-xs font-bold transition-all text-slate-400 hover:text-slate-100';
        } else {
            summaryBtn.className = 'px-4 py-1.5 rounded-lg text-xs font-bold transition-all bg-sky-500 text-slate-950';
            listBtn.className = 'px-4 py-1.5 rounded-lg text-xs font-bold transition-all text-slate-400 hover:text-slate-100';
        }

        this.renderLoans();
    },

    getGroupedCreditorData(loans) {
        const groups = {};
        loans.forEach(l => {
            const creditor = l.end_user;
            const priority = l.priority || this.getLoanPriorityData(l);
            
            if (!groups[creditor]) {
                groups[creditor] = {
                    name: creditor,
                    totalPrincipal: 0,
                    totalInterest: 0,
                    loans: [],
                    latestDate: new Date(0),
                    maxPriority: 4 // Start at lowest (Closed/Normal)
                };
            }
            const metrics = this.calculateLoanMetrics(l);
            groups[creditor].totalPrincipal += parseFloat(l.principal);
            groups[creditor].totalInterest += metrics.monthlyTotalInterest;
            groups[creditor].loans.push({ ...l, priority });
            
            // Keep track of the "most urgent" priority in this group
            if (priority.priority < groups[creditor].maxPriority) {
                groups[creditor].maxPriority = priority.priority;
            }
            
            const loanDate = new Date(l.created_at);
            if (loanDate > groups[creditor].latestDate) {
                groups[creditor].latestDate = loanDate;
            }
        });

        // Convert to array and sort: Priority first, then Name
        return Object.values(groups).sort((a, b) => {
            if (a.maxPriority !== b.maxPriority) return a.maxPriority - b.maxPriority;
            return a.name.localeCompare(b.name);
        });
    },

    onLoanCategoryChange(isEdit = false) {
        const prefix = isEdit ? 'edit-' : '';
        const category = document.getElementById(prefix + 'loan-category').value;
        const shareContainer = document.getElementById(prefix + 'share-split-container');
        const currencyField = document.getElementById(prefix + 'loan-currency');
        const userLabel = document.getElementById(prefix + 'loan-user-label');
        
        if (category === 'will_tec') {
            if (shareContainer) shareContainer.classList.add('hidden');
            if (userLabel) userLabel.textContent = "Creditor Name";
            if (currencyField) {
                currencyField.value = 'KWD';
                currencyField.disabled = true;
            }
        } else {
            if (shareContainer) shareContainer.classList.remove('hidden');
            if (userLabel) userLabel.textContent = "End User Name";
            if (currencyField) {
                currencyField.disabled = false;
            }
        }
    }
}

window.AppLogic = AppLogic;
