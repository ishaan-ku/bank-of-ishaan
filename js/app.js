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
        const desc = document.getElementById('input-description').value;

        // Determine transaction type
        const typeEl = document.getElementById('modal-transaction-type');
        const type = typeEl ? typeEl.value : 'add';

        if (type === 'subtract') {
            amount = -Math.abs(amount);
        }

        if (amount && desc) {
            await DB.updateBalance(kidId, amount, desc);
            closeModal();
            document.getElementById('form-transaction').reset();
            if (typeEl) typeEl.value = 'add'; // Reset to default
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
            card.className = 'bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow';
            card.innerHTML = `
                <div class="flex items-center gap-4 mb-4">
                    <img src="${kid.photoURL || 'https://via.placeholder.com/40'}" class="w-12 h-12 rounded-full bg-slate-100">
                    <div>
                        <h4 class="font-bold text-lg text-slate-800">${kid.displayName}</h4>
                        <p class="text-sm text-slate-500">${kid.email}</p>
                    </div>
                </div>
                <div class="mb-6">
                    <p class="text-xs text-slate-400 uppercase tracking-wider font-bold">Current Balance</p>
                    <p class="text-3xl font-bold text-slate-900 balance-display" id="bal-${kid.id}">$${(kid.balance || 0).toFixed(2)}</p>
                </div>
                <div class="flex gap-2">
                    <button class="flex-1 bg-brand-500 hover:bg-brand-600 text-white py-2 rounded-xl font-medium transition-colors btn-add-money" data-id="${kid.id}">Add</button>
                    <button class="flex-1 bg-red-100 hover:bg-red-200 text-red-600 py-2 rounded-xl font-medium transition-colors btn-sub-money" data-id="${kid.id}">Subtract</button>
                    <button class="px-4 py-2 text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-xl font-medium transition-colors btn-set-allowance" data-id="${kid.id}">Allowance</button>
                </div>
            `;
            list.appendChild(card);

            // Subscribe to realtime balance
            const unsub = DB.subscribeToKid(kid.id, (updatedKid) => {
                const el = document.getElementById(`bal-${kid.id}`);
                if (el) el.innerText = `$${(updatedKid.balance || 0).toFixed(2)}`;
            });
            unsubscribes.push(unsub);

            // Button Listeners
            card.querySelector('.btn-add-money').addEventListener('click', () => {
                document.getElementById('modal-transaction').classList.remove('hidden');
                document.getElementById('modal-kid-id').value = kid.id;
                document.getElementById('modal-transaction-type').value = 'add';
                document.getElementById('modal-transaction-title').innerText = `Add Money to ${kid.displayName}`;
                document.getElementById('btn-confirm-transaction').classList.remove('bg-red-600', 'hover:bg-red-700');
                document.getElementById('btn-confirm-transaction').classList.add('bg-brand-600', 'hover:bg-brand-700');
                document.getElementById('btn-confirm-transaction').innerText = "Add Money";
            });

            card.querySelector('.btn-sub-money').addEventListener('click', () => {
                document.getElementById('modal-transaction').classList.remove('hidden');
                document.getElementById('modal-kid-id').value = kid.id;
                document.getElementById('modal-transaction-type').value = 'subtract';
                document.getElementById('modal-transaction-title').innerText = `Subtract from ${kid.displayName}`;
                document.getElementById('btn-confirm-transaction').classList.remove('bg-brand-600', 'hover:bg-brand-700');
                document.getElementById('btn-confirm-transaction').classList.add('bg-red-600', 'hover:bg-red-700');
                document.getElementById('btn-confirm-transaction').innerText = "Take Away";
            });

            card.querySelector('.btn-set-allowance').addEventListener('click', () => {
                document.getElementById('modal-allowance').classList.remove('hidden');
                document.getElementById('modal-allowance-kid-id').value = kid.id;
                document.getElementById('input-allowance-amount').value = kid.allowance || 0;
            });
        });
    });
}

// KID DASHBOARD
function loadKidDashboard() {
    clearListeners();
    // Balance
    const balDisplay = document.getElementById('kid-balance-display');
    const allowDisplay = document.getElementById('kid-allowance-display');

    // Initial fetch to check allowance
    let hasCheckedAllowance = false;

    // Use subscribe for live updates
    const unsubKid = DB.subscribeToKid(currentUser.uid, (kid) => {
        balDisplay.innerText = `$${(kid.balance || 0).toFixed(2)}`;
        allowDisplay.innerText = `$${(kid.allowance || 0).toFixed(2)}/week`; // If we had allowance setting

        // Check allowance (only once per session to avoid loops)
        if (!hasCheckedAllowance) {
            checkAllowance(kid);
            hasCheckedAllowance = true;
        }
    });
    unsubscribes.push(unsubKid);

    // Spend Button
    document.getElementById('btn-kid-spend').onclick = () => {
        document.getElementById('modal-transaction').classList.remove('hidden');
        document.getElementById('modal-kid-id').value = currentUser.uid;
        document.getElementById('modal-transaction-type').value = 'subtract';
        document.getElementById('modal-transaction-title').innerText = `Spend Money`;
        document.getElementById('input-description').placeholder = "What did you buy?";
        document.getElementById('btn-confirm-transaction').classList.remove('bg-brand-600', 'hover:bg-brand-700');
        document.getElementById('btn-confirm-transaction').classList.add('bg-red-600', 'hover:bg-red-700');
        document.getElementById('btn-confirm-transaction').innerText = "Spend";
    };

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
            item.className = 'p-4 flex justify-between items-center hover:bg-slate-50 transition-colors';
            item.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="p-2 rounded-lg ${isPos ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${isPos ? 'M12 4v16m8-8H4' : 'M20 12H4'}" /> 
                             <!-- Simplistic icons -->
                        </svg>
                    </div>
                    <div>
                        <p class="font-medium text-slate-800">${tx.description}</p>
                        <p class="text-xs text-slate-400">${date}</p>
                    </div>
                </div>
                <span class="font-bold ${isPos ? 'text-green-600' : 'text-slate-900'}">
                    ${isPos ? '+' : ''}$${Math.abs(tx.amount).toFixed(2)}
                </span>
            `;
            list.appendChild(item);
        });
    });
    unsubscribes.push(unsubTx);
}
