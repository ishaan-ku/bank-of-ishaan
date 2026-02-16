// DOM Elements
const views = {
    loading: document.getElementById('view-loading'),
    login: document.getElementById('view-login'),
    onboarding: document.getElementById('view-onboarding'),
    parent: document.getElementById('view-parent'),
    kid: document.getElementById('view-kid')
};

const nav = {
    bar: document.getElementById('nav-bar'),
    displayName: document.getElementById('user-display-name'),
    avatar: document.getElementById('user-avatar'),
    logout: document.getElementById('btn-logout')
};

// State
let currentUser = null;
let currentRole = null;
let unsubscribes = []; // Listeners to clean up

// Helpers
function showView(viewId) {
    Object.values(views).forEach(el => el.classList.add('hidden'));
    views[viewId.replace('view-', '')].classList.remove('hidden');

    if (viewId === 'view-login' || viewId === 'view-loading') {
        nav.bar.classList.add('hidden');
    } else {
        nav.bar.classList.remove('hidden');
    }
}

function clearListeners() {
    unsubscribes.forEach(u => u());
    unsubscribes = [];
}

// Allowance Logic
async function checkAllowance(kidData) {
    if (!kidData.allowance || kidData.allowance <= 0) return;

    // Default to weekly if not specified (MVP)
    // Real app would have 'frequency' field.
    // Let's assume weekly for now.
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const lastDate = kidData.lastAllowanceDate ? kidData.lastAllowanceDate.toDate() : null;

    if (!lastDate || (now.getTime() - lastDate.getTime() > ONE_WEEK_MS)) {
        console.log("Triggering Allowance...");
        // Update last allowance date first to prevent double pay (optimistic)
        // In real app, use backend transaction/function.

        // We need to update user doc with new lastAllowanceDate
        const { doc, updateDoc, serverTimestamp } = window.firebaseModules;

        try {
            await DB.updateBalance(kidData.id, kidData.allowance, "Weekly Allowance");
            await updateDoc(doc(window.db, "users", kidData.id), {
                lastAllowanceDate: serverTimestamp()
            });
            console.log("Allowance paid!");
        } catch (e) {
            console.error("Error paying allowance", e);
        }
    }
}

// Interest Logic (Custom or 5% APY)
async function checkInterest(kidData) {
    if (!kidData.balance || kidData.balance <= 0) return;

    const APY = kidData.interestRate ? parseFloat(kidData.interestRate) : 0.05;
    const MONTHLY_RATE = APY / 12;
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    // For testing: Uncomment this to force interest every 1 minute
    // const THIRTY_DAYS_MS = 60 * 1000; 

    const now = new Date();
    const lastDate = kidData.lastInterestDate ? kidData.lastInterestDate.toDate() : null;

    // If never paid, set last interest to now (start clock)
    if (!lastDate) {
        const { doc, updateDoc, serverTimestamp } = window.firebaseModules;
        await updateDoc(doc(window.db, "users", kidData.id), {
            lastInterestDate: serverTimestamp()
        });
        return;
    }

    if (now.getTime() - lastDate.getTime() > THIRTY_DAYS_MS) {
        console.log("Triggering Interest...");
        const interestAmount = kidData.balance * MONTHLY_RATE;

        // Minimum $0.01
        if (interestAmount < 0.01) return;

        const { doc, updateDoc, serverTimestamp } = window.firebaseModules;

        try {
            await DB.updateBalance(kidData.id, interestAmount.toFixed(2), "Monthly Interest (5% APY)");
            await updateDoc(doc(window.db, "users", kidData.id), {
                lastInterestDate: serverTimestamp()
            });
            console.log("Interest paid!");
            // Optional: User notification toast
        } catch (e) {
            console.error("Error paying interest", e);
        }
    }
}


// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Buttons
    document.getElementById('btn-login-google').addEventListener('click', () => Auth.signIn());
    nav.logout.addEventListener('click', () => Auth.signOut());

    // Role Selection
    document.getElementById('btn-role-parent').addEventListener('click', () => setRole('parent'));
    document.getElementById('btn-role-kid').addEventListener('click', () => setRole('kid'));

    // Parent Logic: Add Kid
    document.getElementById('form-add-kid').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('input-kid-email').value;
        // Verify kid exists
        // Since we can't easily query by email in a secure way without an index or functions in a strict environment,
        // and our security rules (if default) might block it, we will try our best.
        // For MVP, we assume we can find them.
        try {
            const kidUser = await DB.findKidByEmail(email);
            if (kidUser) {
                await DB.linkKidToParent(currentUser.uid, kidUser.uid);
                alert(`Linked ${email} successfully!`);
                document.getElementById('input-kid-email').value = '';
                loadParentDashboard(); // Refresh
            } else {
                alert("Could not find a kid account with that email. Have they signed in yet and selected 'Kid'?");
            }
        } catch (err) {
            console.error(err);
            alert("Error linking kid.");
        }
    });

    // Modal Logic
    const modal = document.getElementById('modal-transaction');
    window.closeModal = () => modal.classList.add('hidden');

    document.getElementById('form-transaction').addEventListener('submit', async (e) => {
        e.preventDefault();
        const kidId = document.getElementById('modal-kid-id').value;
        let amount = parseFloat(document.getElementById('input-amount').value);
        let desc = document.getElementById('input-description').value;
        const accountType = document.getElementById('modal-transaction-account').value || 'checking';

        if (!desc) desc = "Transfer"; // Default description

        // Determine transaction type
        const typeEl = document.getElementById('modal-transaction-type');
        const type = typeEl ? typeEl.value : 'add';

        if (type === 'subtract') {
            amount = -Math.abs(amount);
        }

        if (amount) {
            try {
                await DB.updateBalance(kidId, amount, desc, accountType);
                closeModal();
                document.getElementById('form-transaction').reset();
                if (typeEl) typeEl.value = 'add'; // Reset to default
            } catch (err) {
                alert(err.message);
            }
        }
    });

    // Move Money Modal Logic
    const moveMoneyModal = document.getElementById('modal-move-money');
    window.closeMoveMoneyModal = () => moveMoneyModal.classList.add('hidden');

    // Logic to toggle "To" field based on "From"
    document.getElementById('input-move-from').addEventListener('change', (e) => {
        const toField = document.getElementById('input-move-to');
        toField.value = e.target.value === 'checking' ? 'Savings' : 'Checking';
    });

    document.getElementById('form-move-money').addEventListener('submit', async (e) => {
        e.preventDefault();
        const kidId = document.getElementById('modal-move-money-kid-id').value;
        const fromType = document.getElementById('input-move-from').value;
        const toType = fromType === 'checking' ? 'savings' : 'checking'; // Opposite
        const amount = parseFloat(document.getElementById('input-move-amount').value);

        if (kidId && amount) {
            try {
                await DB.transferInternal(kidId, fromType, toType, amount);
                alert(`Moved $${amount.toFixed(2)} to ${toType === 'checking' ? 'Checking' : 'Savings'}!`);
                closeMoveMoneyModal();
                document.getElementById('form-move-money').reset();
            } catch (err) {
                alert(err.message);
            }
        }
    });

    // Allowance Modal Logic
    const allowanceModal = document.getElementById('modal-allowance');
    window.closeAllowanceModal = () => allowanceModal.classList.add('hidden');

    document.getElementById('form-allowance').addEventListener('submit', async (e) => {
        e.preventDefault();
        const kidId = document.getElementById('modal-allowance-kid-id').value;
        const amount = document.getElementById('input-allowance-amount').value;

        if (kidId && amount !== null) {
            const { doc, updateDoc } = window.firebaseModules;
            await updateDoc(doc(window.db, "users", kidId), {
                allowance: parseFloat(amount)
            });
            alert("Allowance updated!");
            closeAllowanceModal();
        }
    });

    // Interest Modal Logic
    const interestModal = document.getElementById('modal-interest');
    window.closeInterestModal = () => interestModal.classList.add('hidden');

    document.getElementById('form-interest').addEventListener('submit', async (e) => {
        e.preventDefault();
        const kidId = document.getElementById('modal-interest-kid-id').value;
        const ratePercent = document.getElementById('input-interest-rate').value;

        if (kidId && ratePercent !== null) {
            const { doc, updateDoc } = window.firebaseModules;
            const decimalRate = parseFloat(ratePercent) / 100;

            await updateDoc(doc(window.db, "users", kidId), {
                interestRate: decimalRate
            });
            alert(`Interest rate updated to ${ratePercent}% APY!`);
            closeInterestModal();
        }
    });

    // Transfer Modal Logic
    const transferModal = document.getElementById('modal-transfer');
    window.closeTransferModal = () => transferModal.classList.add('hidden');

    document.getElementById('form-transfer').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fromId = document.getElementById('modal-transfer-from-id').value;
        const email = document.getElementById('input-transfer-email').value;
        const amount = parseFloat(document.getElementById('input-transfer-amount').value);
        const desc = document.getElementById('input-transfer-desc').value;

        if (fromId && email && amount) {
            try {
                await DB.transferMoney(fromId, email, amount, desc);
                alert(`Sent $${amount.toFixed(2)} to ${email}!`);
                closeTransferModal();
                document.getElementById('form-transfer').reset();
            } catch (err) {
                alert(err.message);
                console.error(err);
            }
        }
    });

    // Start Auth
    Auth.init(handleUserChange);
});

async function setRole(role) {
    if (!currentUser) return;
    await DB.setUserRole(currentUser, role);
    currentRole = role;
    handleUserChange(currentUser, role);
}

function handleUserChange(user, role) {
    currentUser = user;
    currentRole = role;

    if (user) {
        // Update Nav
        nav.displayName.innerText = user.displayName;
        nav.avatar.src = user.photoURL;

        if (role) {
            if (role === 'parent') {
                showView('view-parent');
                loadParentDashboard();
            } else {
                showView('view-kid');
                loadKidDashboard();
            }
        } else {
            showView('view-onboarding');
        }
    } else {
        clearListeners();
        showView('view-login');
    }
}

// PARENT DASHBOARD
function loadParentDashboard() {
    clearListeners();
    const list = document.getElementById('parent-kids-list');
    list.innerHTML = '<div class="text-center p-4"><div class="animate-spin h-6 w-6 border-b-2 border-brand-500 mx-auto"></div></div>';

    DB.getKids(currentUser.uid).then(kids => {
        list.innerHTML = '';
        if (kids.length === 0) {
            list.innerHTML = '<p class="text-slate-400 col-span-full text-center py-8">No kids linked yet. Add one below!</p>';
            return;
        }

        kids.forEach(kid => {
            const card = document.createElement('div');
            card.className = 'glass-card p-6 rounded-2xl hover:shadow-lg transition-all duration-300';
            card.innerHTML = `
                <div class="flex items-center gap-4 mb-6">
                    <img src="${kid.photoURL || 'https://via.placeholder.com/40'}" class="w-14 h-14 rounded-full bg-white shadow-sm object-cover border-2 border-white">
                    <div>
                        <h4 class="font-bold text-xl text-slate-800">${kid.displayName}</h4>
                        <p class="text-sm text-slate-500 font-medium">${kid.email}</p>
                    </div>
                </div>
                <div class="mb-6 grid grid-cols-2 gap-4">
                    <div class="bg-brand-50/50 p-4 rounded-2xl border border-brand-100">
                        <p class="text-xs text-brand-400 uppercase tracking-wider font-bold mb-1">Checking</p>
                        <p class="text-2xl font-bold text-brand-700" id="bal-${kid.id}">$${(kid.balance || 0).toFixed(2)}</p>
                    </div>
                    <div class="bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100">
                        <p class="text-xs text-emerald-500 uppercase tracking-wider font-bold mb-1">Savings</p>
                        <p class="text-2xl font-bold text-emerald-700" id="sav-${kid.id}">$${(kid.savingsBalance || 0).toFixed(2)}</p>
                    </div>
                </div>
                
                <div class="mb-6">
                     <p class="text-xs text-slate-400 uppercase tracking-wider font-bold mb-3">Recent Activity</p>
                     <ul class="text-sm space-y-2" id="tx-list-${kid.id}">
                        <li class="text-slate-400 italic text-xs">Loading...</li>
                     </ul>
                </div>
                <div class="flex gap-2 mb-3">
                    <button class="flex-1 bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-xl font-medium transition-all shadow-md shadow-brand-500/20 btn-add-money" data-id="${kid.id}">Add</button>
                    <button class="flex-1 bg-white hover:bg-red-50 text-red-600 border border-red-100 py-2.5 rounded-xl font-medium transition-colors btn-sub-money" data-id="${kid.id}">Subtract</button>
                </div>
                <div class="flex gap-2">
                     <button class="flex-1 px-4 py-2 text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-xl font-medium transition-colors btn-set-allowance" data-id="${kid.id}">Allowance</button>
                     <button class="flex-1 px-4 py-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl font-medium transition-colors btn-set-interest" data-id="${kid.id}">Interest</button>
                </div>
            `;
            list.appendChild(card);

            // Subscribe to realtime balance
            const unsub = DB.subscribeToKid(kid.id, (updatedKid) => {
                const el = document.getElementById(`bal-${kid.id}`);
                const elSav = document.getElementById(`sav-${kid.id}`);
                if (el) el.innerText = `$${(updatedKid.balance || 0).toFixed(2)}`;
                if (elSav) elSav.innerText = `$${(updatedKid.savingsBalance || 0).toFixed(2)}`;
            });
            unsubscribes.push(unsub);

            // Subscribe to recent transactions (limit 3 for compact view)
            const unsubTx = DB.subscribeToTransactions(kid.id, (txs) => {
                const listEl = document.getElementById(`tx-list-${kid.id}`);
                if (!listEl) return;

                if (txs.length === 0) {
                    listEl.innerHTML = '<li class="text-slate-400 italic text-xs text-center py-2">No activity yet.</li>';
                    return;
                }

                listEl.innerHTML = '';
                // Take top 3
                txs.slice(0, 3).forEach(tx => {
                    const isPos = tx.amount > 0;
                    const date = tx.timestamp ? new Date(tx.timestamp.seconds * 1000).toLocaleDateString() : '';

                    const li = document.createElement('li');
                    li.className = 'flex justify-between items-center bg-white/60 p-2.5 rounded-xl border border-slate-50';
                    li.innerHTML = `
                        <div class="truncate mr-2">
                            <p class="font-medium text-slate-700 truncate text-xs" title="${tx.description}">${tx.description}</p>
                            <p class="text-[10px] text-slate-400">${date}</p>
                        </div>
                        <span class="font-bold whitespace-nowrap text-xs ${isPos ? 'text-emerald-600' : 'text-slate-600'}">
                            ${isPos ? '+' : ''}$${Math.abs(tx.amount).toFixed(2)}
                        </span>
                    `;
                    listEl.appendChild(li);
                });
            });
            unsubscribes.push(unsubTx);

            // Button Listeners
            card.querySelector('.btn-add-money').addEventListener('click', () => {
                document.getElementById('modal-transaction').classList.remove('hidden');
                document.getElementById('modal-kid-id').value = kid.id;
                document.getElementById('modal-transaction-type').value = 'add';
                document.getElementById('modal-transaction-title').innerText = `Add Money to ${kid.displayName}`;

                // Show account selector
                document.getElementById('modal-transaction-account').closest('div').classList.remove('hidden');

                document.getElementById('btn-confirm-transaction').classList.remove('bg-red-600', 'hover:bg-red-700');
                document.getElementById('btn-confirm-transaction').classList.add('bg-brand-600', 'hover:bg-brand-700');
                document.getElementById('btn-confirm-transaction').innerText = "Add Money";
            });

            card.querySelector('.btn-sub-money').addEventListener('click', () => {
                document.getElementById('modal-transaction').classList.remove('hidden');
                document.getElementById('modal-kid-id').value = kid.id;
                document.getElementById('modal-transaction-type').value = 'subtract';
                document.getElementById('modal-transaction-title').innerText = `Subtract from ${kid.displayName}`;

                // Show account selector
                document.getElementById('modal-transaction-account').closest('div').classList.remove('hidden');

                document.getElementById('btn-confirm-transaction').classList.remove('bg-brand-600', 'hover:bg-brand-700');
                document.getElementById('btn-confirm-transaction').classList.add('bg-red-600', 'hover:bg-red-700');
                document.getElementById('btn-confirm-transaction').innerText = "Take Away";
            });

            card.querySelector('.btn-set-allowance').addEventListener('click', () => {
                document.getElementById('modal-allowance').classList.remove('hidden');
                document.getElementById('modal-allowance-kid-id').value = kid.id;
                document.getElementById('input-allowance-amount').value = kid.allowance || 0;
            });

            card.querySelector('.btn-set-interest').addEventListener('click', () => {
                document.getElementById('modal-interest').classList.remove('hidden');
                document.getElementById('modal-interest-kid-id').value = kid.id;
                // Default to 5 or current
                const currentRate = (kid.interestRate !== undefined) ? (kid.interestRate * 100).toFixed(2) : "5.00";
                document.getElementById('input-interest-rate').value = currentRate;
            });
        });
    });
}

// KID DASHBOARD
function loadKidDashboard() {
    clearListeners();
    // Balance
    const balDisplay = document.getElementById('kid-balance-display');
    const savDisplay = document.getElementById('kid-savings-display');
    const rateDisplay = document.getElementById('kid-interest-rate-display');

    // Initial fetch to check allowance
    let hasCheckedAllowance = false;

    // Use subscribe for live updates
    const unsubKid = DB.subscribeToKid(currentUser.uid, (kid) => {
        balDisplay.innerText = `$${(kid.balance || 0).toFixed(2)}`;
        if (savDisplay) savDisplay.innerText = `$${(kid.savingsBalance || 0).toFixed(2)}`;

        // Update Interest Rate Display
        const APY = kid.interestRate ? parseFloat(kid.interestRate) : 0.05;
        if (rateDisplay) rateDisplay.innerText = `${(APY * 100).toFixed(1)}% APY`;

        // Check allowance (only once per session to avoid loops)
        if (!hasCheckedAllowance) {
            checkAllowance(kid);
            checkInterest(kid);
            hasCheckedAllowance = true;
        }

        // Show Withdrawal Limit info if present
        const limitDisplay = document.getElementById('kid-savings-limit-display');
        const currentMonth = new Date().getMonth();
        let count = 0;

        if (kid.lastWithdrawalMonth === currentMonth) {
            count = kid.savingsWithdrawalCount || 0;
        }

        if (limitDisplay) {
            limitDisplay.innerText = `${4 - count} withdrawals left this month`;
        } else {
            // Inject if missing (Quick fix since we don't want to edit HTML structure heavily)
            if (savDisplay && savDisplay.parentElement) {
                const p = document.createElement('p');
                p.id = 'kid-savings-limit-display';
                p.className = 'text-xs text-emerald-200 mt-1';
                p.innerText = `${4 - count} withdrawals left this month`;
                savDisplay.parentElement.appendChild(p);
            }
        }
    });
    unsubscribes.push(unsubKid);

    // Spend Button
    document.getElementById('btn-kid-spend').onclick = () => {
        document.getElementById('modal-transaction').classList.remove('hidden');
        document.getElementById('modal-kid-id').value = currentUser.uid;
        document.getElementById('modal-transaction-type').value = 'subtract';
        document.getElementById('modal-transaction-title').innerText = `Spend Money`;
        document.getElementById('modal-transaction-account').value = 'checking'; // Default to checking
        document.getElementById('input-description').placeholder = "What did you buy?";

        // Simplified: Kid spends from Checking. 
        document.getElementById('modal-transaction-account').closest('div').classList.add('hidden'); // Hide selector for kids spend

        document.getElementById('btn-confirm-transaction').classList.remove('bg-brand-600', 'hover:bg-brand-700');
        document.getElementById('btn-confirm-transaction').classList.add('bg-red-600', 'hover:bg-red-700');
        document.getElementById('btn-confirm-transaction').innerText = "Spend";
    };

    // Move Money Button (Internal)
    const btnMove = document.getElementById('btn-kid-internal-transfer');
    if (btnMove) {
        btnMove.onclick = () => {
            document.getElementById('modal-move-money').classList.remove('hidden');
            document.getElementById('modal-move-money-kid-id').value = currentUser.uid;
        };
    }

    // Send Money Button (New)
    // We need to add the button to the DOM first if it doesn't exist.
    // Let's assume we modify index.html OR inject it here.
    // Easier to inject it into the 'Quick Actions' card if we can identify it.
    // Index.html has key IDs. Let's look at kid view HTML structure in my head...
    // It has a 'grid-cols-2 gap-4' for buttons.
    // Let's find the Actions section.

    // Actually, let's verify if I added the button to index.html in the previous tool call?
    // I did NOT add the button to index.html's Kid View, only the Modal.
    // I need to add the button to the Kid UI.
    // I'll do it via innerHTML injection for now or modify index.html in next step.
    // Let's modify index.html in next step for the button.
    // For now, I'll add the listener assuming ID 'btn-kid-transfer' exists.

    const btnTransfer = document.getElementById('btn-kid-transfer');
    if (btnTransfer) {
        btnTransfer.onclick = () => {
            document.getElementById('modal-transfer').classList.remove('hidden');
            document.getElementById('modal-transfer-from-id').value = currentUser.uid;
        };
    }

    // Transactions
    const list = document.getElementById('kid-transactions-list');
    const unsubTx = DB.subscribeToTransactions(currentUser.uid, (txs) => {
        list.innerHTML = '';
        if (txs.length === 0) {
            list.innerHTML = '<li class="p-4 text-center text-slate-400">No transactions yet.</li>';
            return;
        }

        txs.forEach(tx => {
            const date = tx.timestamp ? new Date(tx.timestamp.seconds * 1000).toLocaleDateString() : 'Just now';
            const isPos = tx.amount > 0;

            const item = document.createElement('li');
            item.className = 'p-6 flex justify-between items-center hover:bg-slate-50/50 transition-colors border-b border-slate-100/50 last:border-0';
            item.innerHTML = `
                <div class="flex items-center gap-4">
                    <div class="p-3 rounded-2xl ${isPos ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${isPos ? 'M12 4v16m8-8H4' : 'M20 12H4'}" /> 
                        </svg>
                    </div>
                    <div>
                        <p class="font-bold text-slate-800 text-lg">${tx.description}</p>
                        <p class="text-xs text-slate-400 font-medium">${date}</p>
                    </div>
                </div>
                <span class="font-bold text-lg ${isPos ? 'text-emerald-600' : 'text-slate-800'}">
                    ${isPos ? '+' : ''}$${Math.abs(tx.amount).toFixed(2)}
                </span>
            `;
            list.appendChild(item);
        });
    });
    unsubscribes.push(unsubTx);
}
