const AppLogic = {
    currentView: 'transactions',
    viewTitle: document.getElementById('current-view-title'),
    displayDate: document.getElementById('display-date'),
    modalContainer: document.getElementById('modal-container'),

    async init() {
        // Auto-recalculate on startup to fix any legacy sign issues
        await Store.recalculateBalances();

        this.updateClock();
        setInterval(() => this.updateClock(), 60000);
        this.setupNavigation();
        await this.setupForms(); // Now async
        await this.renderAll();
        this.updateConnectionStatus();

        // Default date to today
        document.getElementById('tx-date').valueAsDate = new Date();
    },

    async updateConnectionStatus() {
        const dot = document.getElementById('connection-status');
        if (!dot) return;
        const connected = await Store.checkConnection();
        dot.className = `w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'}`;
        dot.title = connected ? 'Cloud Connected' : 'Cloud Offline / Setup Required';
    },

    async refreshFromCloud() {
        Auth.showToast("Syncing with cloud...");
        const success = await Store.loadFromCloud();
        if (success) {
            await this.renderAll();
            this.updateConnectionStatus();
            Auth.showToast("Data retrieved from cloud!");
        } else {
            Auth.showToast("Failed to retrieve data. Check Supabase setup.", "error");
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

        // --- Contra Validations ---
        if (tx.type === 'contra') {
            const from = Store.data.accounts.find(a => a.id == tx.accountId) || Store.data.ledgers.find(l => l.id == tx.accountId);
            const to = Store.data.accounts.find(a => a.id == tx.toId) || Store.data.ledgers.find(l => l.id == tx.toId);

            // 1. Prevent overlapping source/target
            if (tx.accountId == tx.toId) {
                Auth.showToast("Source and Target cannot be the same", "error");
                return;
            }

            // 2. Ledger Validation (Don't over-settle)
            if (from && from.groupId !== undefined && from.groupId > 2) {
                if (tx.amount > Math.abs(from.balance) + 0.001) {
                    Auth.showToast("Amount exceeds outstanding balance", "error");
                    return;
                }
            }
            if (to && to.groupId !== undefined && to.groupId > 2) {
                // If it's a Ledger-to-Ledger move, we should check compatibility
                if (from && from.groupId !== undefined) {
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
        Auth.showToast("Entry Saved");
    },

    async renderAll() {
        this.populateDropdowns();
        this.renderHistory();
        this.renderLedgers();
        this.renderLedgerGroups();
        this.renderAccounts();
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

        let txs = Store.data.transactions;

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
            const from = Store.data.accounts.find(a => a.id == updated.accountId) || Store.data.ledgers.find(l => l.id == updated.accountId);
            const to = Store.data.accounts.find(a => a.id == updated.toId) || Store.data.ledgers.find(l => l.id == updated.toId);

            if (updated.accountId == updated.toId) {
                Auth.showToast("Source and Target cannot be the same", "error");
                return;
            }

            // Note: Since balances might be "in flux" during edit (we reverse old then apply new), 
            // a strict balance check here might be tricky if we don't account for the old transaction's impact.
            // However, Store.updateTransaction handles reversing first. 
            // To be truly safe, we'd check if (amount > currentBalance + (wasOldTxFromSource ? oldAmount : 0)).
            // But for simplicity and safety, we allow edits but warn if it looks wrong.
            // Actually, let's keep it simple as per requirements.
            if (from && from.groupId !== undefined && from.groupId > 2) {
                // If it was already from this source, we allow the original amount back
                const oldTx = Store.data.transactions.find(t => t.id === id);
                let available = Math.abs(from.balance);
                if (oldTx && oldTx.accountId == updated.accountId) available += oldTx.amount;

                if (updated.amount > available + 0.001) {
                    Auth.showToast("Amount exceeds outstanding balance", "error");
                    return;
                }
            }
            if (to && to.groupId !== undefined && to.groupId > 2) {
                if (from && from.groupId !== undefined) {
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

    showStatement(type, id) {
        const item = Store.data[type + 's'].find(i => i.id == id);
        // Get transactions, sort chronologically for balance calculation
        const relevantTxs = Store.data.transactions.filter(t =>
            (type === 'account' && (t.accountId == id || t.toId == id)) ||
            (type === 'ledger' && (t.ledgerId == id || t.accountId == id || t.toId == id))
        ).sort((a, b) => a.id - b.id);

        let runningBal = item.openingBalance || 0;
        let totalIn = 0;
        let totalOut = 0;

        const statementRows = relevantTxs.map(t => {
            let isIn = false, isOut = false;
            if (type === 'account') {
                isOut = (t.type === 'expense' && t.accountId == id) || (t.type === 'contra' && t.accountId == id);
                isIn = (t.type === 'income' && t.accountId == id) || (t.type === 'contra' && t.toId == id);
            } else {
                // Ledger Perspective: Income increases what they owe (In), Expense decreases (Out)
                // Actually, as per previous fix: Expense (user pays them) = Led+, Income (they pay user) = Led-
                // So "In" for Ledger = User paying them? No, usually In means money coming IN to account.
                // Let's stick to user perspective: In = Received from them, Out = Paid to them.
                isOut = (t.type === 'expense' && t.ledgerId == id) || (t.type === 'contra' && t.toId == id); // Paid to them
                isIn = (t.type === 'income' && t.ledgerId == id) || (t.type === 'contra' && t.accountId == id); // Recv from them
            }

            if (isIn) {
                totalIn += t.amount;
                // For rolling ledgers, income decreases the asset (He owes me less)
                runningBal += (type === 'ledger' && item.groupId > 2) ? -t.amount : t.amount;
            }
            if (isOut) {
                totalOut += t.amount;
                // For rolling ledgers, expense increases the asset (I paid him, he owes me more)
                runningBal += (type === 'ledger' && item.groupId > 2) ? t.amount : -t.amount;
            }

            return { ...t, isIn, isOut, currentBal: runningBal };
        });

        // Generate rows (relevantTxs is already sorted ascending)

        let html = `
            <div onclick="this.parentElement.classList.add('hidden')" 
                class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">
                <div onclick="event.stopPropagation()" 
                    id="modal-content" class="bg-slate-900 w-full max-w-3xl rounded-t-3xl md:rounded-3xl p-6 lg:p-8 space-y-6 shadow-2xl border-t border-slate-800 transform animate-fade-in flex flex-col max-h-[90vh]">
                    <div class="flex items-center justify-between">
                        <div>
                            <h2 class="text-xl font-bold font-orbitron text-slate-100">${item.name}</h2>
                            <p class="text-xs text-slate-500 uppercase tracking-widest">Statement History</p>
                        </div>
                        <div class="flex items-center space-x-2">
                            <button onclick="AppLogic.exportStatementToExcel('${type}', ${id})" class="hidden md:flex items-center space-x-2 bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-500/30 hover:bg-emerald-500/30 transition-all">
                                <i class="fas fa-file-excel"></i>
                                <span>Export to Excel</span>
                            </button>
                            <button onclick="document.getElementById('modal-container').classList.add('hidden')" class="text-slate-500 hover:text-slate-300 font-bold text-sm uppercase tracking-wider cursor-pointer"><i class="fas fa-times"></i></button>
                        </div>
                    </div>

                    <div class="flex-1 overflow-x-auto overflow-y-auto pr-2 custom-scrollbar">
                        <table class="w-full text-left text-sm border-separate border-spacing-0">
                            <thead class="sticky top-0 bg-slate-900 text-slate-500 border-b border-slate-800 z-10">
                                <tr>
                                    <th class="py-3 px-2 font-bold uppercase text-[9px] tracking-widest border-b border-slate-800">Date</th>
                                    <th class="py-3 px-2 font-bold uppercase text-[9px] tracking-widest border-b border-slate-800">Item / Particulars</th>
                                    <th class="py-3 px-2 font-bold uppercase text-[9px] tracking-widest text-rose-400 border-b border-slate-800">Paid (Out)</th>
                                    <th class="py-3 px-2 font-bold uppercase text-[9px] tracking-widest text-emerald-400 border-b border-slate-800">Recv (In)</th>
                                    <th class="py-3 px-2 font-bold uppercase text-[9px] tracking-widest text-sky-400 text-right border-b border-slate-800">Available Balance</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-800/30">
                                <tr class="bg-slate-950/30">
                                    <td class="py-3 px-2 text-[10px] text-slate-500 font-bold uppercase" colspan="2">Opening Balance</td>
                                    <td class="py-3 px-2" colspan="2"></td>
                                    <td class="py-3 px-2 text-right font-orbitron text-xs text-slate-400">
                                        ${item.openingBalance >= 0 ? '+' : ''}${item.openingBalance.toFixed(3)}
                                    </td>
                                </tr>
                                ${statementRows.map(t => {
            let relatedName = '-';
            if (type === 'account') {
                // Watching a Bank: Who is the Ledger?
                const led = Store.data.ledgers.find(l => l.id == t.ledgerId);
                if (led) relatedName = led.name;
                else if (t.type === 'contra') {
                    // If contra, the other side is an account
                    const otherAccId = t.accountId == id ? t.toId : t.accountId;
                    const otherAcc = Store.data.accounts.find(a => a.id == otherAccId);
                    relatedName = otherAcc ? `Transfer: ${otherAcc.name}` : 'Transfer';
                }
            } else {
                // Watching a Ledger: Which Bank was used?
                const acc = Store.data.accounts.find(a => a.id == t.accountId);
                if (acc) relatedName = acc.name;
                else if (t.type === 'contra') {
                    // Contra in ledger view (unusual but possible if ledger used as source)
                    const otherId = t.accountId == id ? t.toId : t.accountId;
                    const other = Store.data.accounts.find(a => a.id == otherId) || Store.data.ledgers.find(l => l.id == otherId);
                    relatedName = other ? `Transfer: ${other.name}` : 'Transfer';
                }
            }

            return `
                                        <tr onclick="AppLogic.editTx(${t.id})" class="hover:bg-slate-800/50 transition-colors cursor-pointer group">
                                            <td class="py-3 px-2 whitespace-nowrap text-slate-400 text-[11px] font-orbitron group-hover:text-sky-400 transition-colors">${t.date.split('-').slice(1).join('/')}</td>
                                            <td class="py-3 px-2 max-w-[180px]">
                                                <div class="text-[10px] text-sky-400 font-bold uppercase truncate">
                                                    ${t.type === 'contra' ? `Transfer: ${relatedName}` : relatedName}
                                                </div>
                                                <div class="text-[10px] text-slate-500 truncate" title="${t.remark}">${t.remark || '-'}</div>
                                            </td>
                                            <td class="py-3 px-2 text-rose-400 font-orbitron text-xs font-medium">${t.isOut ? t.amount.toFixed(3) : '-'}</td>
                                            <td class="py-3 px-2 text-emerald-400 font-orbitron text-xs font-medium">${t.isIn ? t.amount.toFixed(3) : '-'}</td>
                                            <td class="py-3 px-2 text-right font-orbitron text-xs ${t.currentBal < 0 ? 'text-rose-400' : 'text-sky-400'}">
                                                ${t.currentBal < 0 ? '' : '+'}${t.currentBal.toFixed(3)}
                                            </td>
                                        </tr>
                                    `;
        }).join('')}
                            </tbody>
                        </table>
                    </div>

                    <div class="grid grid-cols-3 gap-4 pt-4 border-t border-slate-800">
                        <div class="bg-slate-950 p-3 rounded-xl border border-slate-800/50">
                            <div class="text-[8px] text-slate-500 uppercase tracking-widest mb-1">Total Paid</div>
                            <div class="text-sm font-bold font-orbitron text-rose-400">${totalOut.toFixed(3)}</div>
                        </div>
                        <div class="bg-slate-950 p-3 rounded-xl border border-slate-800/50">
                            <div class="text-[8px] text-slate-500 uppercase tracking-widest mb-1">Total Recv</div>
                            <div class="text-sm font-bold font-orbitron text-emerald-400">${totalIn.toFixed(3)}</div>
                        </div>
                        <div class="bg-slate-950 p-3 rounded-xl border border-sky-500/20">
                            <div class="text-[8px] text-sky-500/50 uppercase tracking-widest mb-1">Closing Balance</div>
                            <div class="text-sm font-bold font-orbitron ${item.balance < 0 ? 'text-rose-400' : 'text-sky-400'}">
                                ${item.balance < 0 ? '' : '+'}${item.balance.toFixed(3)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.modalContainer.innerHTML = html;
        this.modalContainer.classList.remove('hidden');
    },

    showTotalMoneyStatement() {
        const accounts = Store.data.accounts;
        const rollingLedgers = Store.data.ledgers.filter(l => l.groupId > 2);

        const initialAccountsVal = accounts.reduce((sum, a) => sum + (a.openingBalance || 0), 0);
        const initialRollingVal = rollingLedgers.reduce((sum, l) => sum + (l.openingBalance || 0), 0);

        let runningNetWorth = initialAccountsVal + initialRollingVal;

        const sortedTxs = [...Store.data.transactions].sort((a, b) => a.id - b.id);

        const statementRows = [];
        let totalNetIn = 0;
        let totalNetOut = 0;

        sortedTxs.forEach(t => {
            let impact = 0;

            // Calculate net impact on "internal" money (Accounts + Rolling Ledgers)
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
                const from = accounts.find(a => a.id == t.accountId) || rollingLedgers.find(l => l.id == t.accountId);
                const to = accounts.find(a => a.id == t.toId) || rollingLedgers.find(l => l.id == t.toId);

                if (from) impact -= t.amount;
                if (to) impact += t.amount;
            }

            if (Math.abs(impact) > 0.0001) {
                runningNetWorth += impact;
                if (impact > 0) totalNetIn += impact;
                else totalNetOut += Math.abs(impact);

                statementRows.push(`
                    <tr class="hover:bg-slate-950/50 transition-colors">
                        <td class="py-3 px-2 whitespace-nowrap text-slate-400 text-[11px] font-orbitron">${t.date.split('-').slice(1).join('/')}</td>
                        <td class="py-3 px-2">
                            <div class="text-[10px] text-slate-500 font-bold uppercase tracking-tighter mb-0.5">${t.type}</div>
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
            <div id="modal-content" class="bg-slate-900 w-full max-w-4xl rounded-t-3xl md:rounded-3xl p-6 lg:p-8 space-y-6 shadow-2xl border-t border-slate-800 transform animate-fade-in flex flex-col max-h-[90vh]">
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-xl font-bold font-orbitron text-teal-400">Net Worth Statement</h2>
                        <p class="text-xs text-slate-500 uppercase tracking-widest">Global Net Worth History</p>
                    </div>
                    <button onclick="window.AppLogic.showSummary()" class="text-slate-500 hover:text-slate-300 font-bold text-sm uppercase tracking-wider cursor-pointer"><i class="fas fa-arrow-left mr-2"></i>Back</button>
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
                            <tr class="bg-slate-950/30">
                                <td class="py-3 px-2 text-[10px] text-slate-500 font-bold uppercase" colspan="2">Initial Opening Balances</td>
                                <td class="py-3 px-2" colspan="2"></td>
                                <td class="py-3 px-2 text-right font-orbitron text-xs text-slate-400">
                                    ${(initialAccountsVal + initialRollingVal).toFixed(3)}
                                </td>
                            </tr>
                            ${statementRows.join('')}
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
                        <div class="text-[8px] text-teal-500/50 uppercase tracking-widest mb-1">Net Worth</div>
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

    exportStatementToExcel(type, id) {
        const item = Store.data[type + 's'].find(i => i.id == id);
        const relevantTxs = Store.data.transactions.filter(t =>
            (type === 'account' && (t.accountId == id || t.toId == id)) ||
            (type === 'ledger' && (t.ledgerId == id || t.accountId == id || t.toId == id))
        ).sort((a, b) => a.id - b.id);

        let csv = "Date,Related To,Remark,Paid (Out),Recv (In),Balance\n";

        // Opening Balance Row
        csv += `Opening Balance,,,,,"${(item.openingBalance || 0).toFixed(3)}"\n`;

        let runningBal = item.openingBalance || 0;
        relevantTxs.forEach(t => {
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
                    relatedName = otherAcc ? `Transfer: ${otherAcc.name}` : 'Transfer';
                }
            } else {
                const acc = Store.data.accounts.find(a => a.id == t.accountId);
                if (acc) relatedName = acc.name;
                else if (t.type === 'contra') {
                    const otherId = t.accountId == id ? t.toId : t.accountId;
                    const other = Store.data.accounts.find(a => a.id == otherId) || Store.data.ledgers.find(l => l.id == otherId);
                    relatedName = other ? `Transfer: ${other.name}` : 'Transfer';
                }
            }

            const row = [
                t.date,
                `"${relatedName}"`,
                `"${t.remark || ''}"`,
                isOut ? t.amount.toFixed(3) : '0.000',
                isIn ? t.amount.toFixed(3) : '0.000',
                `"${runningBal.toFixed(3)}"`
            ];
            csv += row.join(',') + "\n";
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `${item.name}_Statement_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};

window.AppLogic = AppLogic;
