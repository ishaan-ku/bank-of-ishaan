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

const QUIZ_DATA = [
    { id: 'q1', question: "What happens to your money in a savings account?", options: ["It disappears", "The bank pays you interest", "It turns into candy"], correct: 1, reward: 0.50 },
    { id: 'q2', question: "If you save $5 a week for 4 weeks, how much do you have?", options: ["$20", "$10", "$500"], correct: 0, reward: 0.50 },
    { id: 'q3', question: "What is a 'Budget'?", options: ["A type of bird", "A plan for how to spend your money", "A video game"], correct: 1, reward: 0.50 },
    { id: 'q4', question: "Why is it good to start saving early?", options: ["To buy a spaceship", "Compound interest makes it grow more", "Banks like it"], correct: 1, reward: 1.00 },
    { id: 'q5', question: "Which is a 'Need' (not a 'Want')?", options: ["New Video Game", "Designer Shoes", "Healthy Food"], correct: 2, reward: 0.50 }
];

let unsubscribes = []; // Listeners to clean up
let currentQuiz = null; // Track active quiz

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
    document.getElementById('btn-role-parent').addEventListener('click', (e) => setRole(e, 'parent'));
    document.getElementById('btn-role-kid').addEventListener('click', (e) => setRole(e, 'kid'));

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

    // ... (rest of listeners)

    console.log("App Initialized");
});

async function setRole(e, role) {
    if (e) e.preventDefault();
    console.log("Setting role to:", role);
    if (!currentUser) {
        console.error("Cannot set role: currentUser is null");
        return;
    }
    try {
        await DB.setUserRole(currentUser, role);
        currentRole = role;
        console.log("Role set via DB, updating UI...");
        handleUserChange(currentUser, role);
    } catch (err) {
        console.error("Error setting role:", err);
    }
}

function handleUserChange(user, role) {
    console.log("handleUserChange:", user ? user.uid : 'null', "Role:", role);
    currentUser = user;
    currentRole = role;

    if (user) {
        // Update Nav
        nav.displayName.innerText = user.displayName;
        nav.avatar.src = user.photoURL;

        if (role) {
            if (role === 'parent') {
                console.log("Switching to Parent View");
                showView('view-parent');
                loadParentDashboard();
            } else {
                console.log("Switching to Kid View");
                showView('view-kid');
                loadKidDashboard();
            }
        } else {
            console.log("No role found, showing Onboarding");
            showView('view-onboarding');
        }
    } else {
        console.log("No user, showing Login");
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
                <div class="mb-4 grid grid-cols-2 gap-4">
                    <div class="bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <p class="text-xs text-slate-400 uppercase tracking-wider font-bold">Checking</p>
                        <p class="text-xl font-bold text-slate-900" id="bal-${kid.id}">$${(kid.balance || 0).toFixed(2)}</p>
                    </div>
                    <div class="bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                        <p class="text-xs text-emerald-600 uppercase tracking-wider font-bold">Savings</p>
                        <p class="text-xl font-bold text-emerald-700" id="sav-${kid.id}">$${(kid.savingsBalance || 0).toFixed(2)}</p>
                    </div>
                </div>
                
                <div class="mb-4">
                     <p class="text-xs text-slate-400 uppercase tracking-wider font-bold mb-2">Recent Activity</p>
                     <ul class="text-sm space-y-2" id="tx-list-${kid.id}">
                        <li class="text-slate-400 italic text-xs">Loading...</li>
                     </ul>
                </div>
                <div class="flex gap-2 mb-2">
                    <button class="flex-1 bg-brand-500 hover:bg-brand-600 text-white py-2 rounded-xl font-medium transition-colors btn-add-money" data-id="${kid.id}">Add</button>
                    <button class="flex-1 bg-red-100 hover:bg-red-200 text-red-600 py-2 rounded-xl font-medium transition-colors btn-sub-money" data-id="${kid.id}">Subtract</button>
                </div>
                <div class="flex gap-2">
                     <button class="flex-1 px-4 py-2 text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-xl font-medium transition-colors btn-set-allowance" data-id="${kid.id}">Allowance</button>
                     <button class="flex-1 px-4 py-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl font-medium transition-colors btn-set-interest" data-id="${kid.id}">Interest</button>
                </div>
                <button class="w-full py-2 rounded-xl font-medium transition-colors btn-toggle-card mb-2 ${kid.isCardFrozen ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" data-id="${kid.id}" data-frozen="${kid.isCardFrozen || false}">
                    ${kid.isCardFrozen ? '❄️ Unfreeze Card' : '🔒 Freeze Card'}
                </button>
                 <div class="flex items-center justify-between bg-indigo-50 p-3 rounded-xl">
                    <span class="text-sm font-medium text-indigo-900">Financial Quizzes</span>
                    <button class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors btn-toggle-quizzes ${kid.quizzesEnabled !== false ? 'bg-indigo-600' : 'bg-slate-300'}" data-id="${kid.id}" data-enabled="${kid.quizzesEnabled !== false}">
                        <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${kid.quizzesEnabled !== false ? 'translate-x-6' : 'translate-x-1'}"></span>
                    </button>
                </div>
            `;
            list.appendChild(card);

            // Subscribe to realtime balance
            const unsub = DB.subscribeToKid(kid.id, (updatedKid) => {
                const el = document.getElementById(`bal - ${kid.id} `);
                const elSav = document.getElementById(`sav - ${kid.id} `);
                if (el) el.innerText = `$${(updatedKid.balance || 0).toFixed(2)} `;
                if (elSav) elSav.innerText = `$${(updatedKid.savingsBalance || 0).toFixed(2)} `;

                // Update toggle states just in case
                const quizBtn = card.querySelector('.btn-toggle-quizzes');
                const isEnabled = updatedKid.quizzesEnabled !== false;
                quizBtn.className = `relative inline - flex h - 6 w - 11 items - center rounded - full transition - colors btn - toggle - quizzes ${isEnabled ? 'bg-indigo-600' : 'bg-slate-300'} `;
                quizBtn.querySelector('span').className = `inline - block h - 4 w - 4 transform rounded - full bg - white transition - transform ${isEnabled ? 'translate-x-6' : 'translate-x-1'} `;
                quizBtn.dataset.enabled = isEnabled;
            });
            unsubscribes.push(unsub);

            // Subscribe to recent transactions (limit 3 for compact view)
            const unsubTx = DB.subscribeToTransactions(kid.id, (txs) => {
                const listEl = document.getElementById(`tx - list - ${kid.id} `);
                if (!listEl) return;

                if (txs.length === 0) {
                    listEl.innerHTML = '<li class="text-slate-400 italic text-xs">No activity yet.</li>';
                    return;
                }

                listEl.innerHTML = '';
                // Take top 3
                txs.slice(0, 3).forEach(tx => {
                    const isPos = tx.amount > 0;
                    const date = tx.timestamp ? new Date(tx.timestamp.seconds * 1000).toLocaleDateString() : '';

                    const li = document.createElement('li');
                    li.className = 'flex justify-between items-center bg-slate-50 p-2 rounded-lg';

                    // Create elements securely
                    const leftDiv = document.createElement('div');
                    leftDiv.className = 'truncate mr-2';

                    const descP = document.createElement('p');
                    descP.className = 'font-medium text-slate-700 truncate';
                    descP.title = tx.description;
                    descP.textContent = tx.description; // Secure

                    const dateP = document.createElement('p');
                    dateP.className = 'text-[10px] text-slate-400';
                    dateP.textContent = date;

                    leftDiv.append(descP, dateP);

                    const rightSpan = document.createElement('span');
                    rightSpan.className = `font - bold whitespace - nowrap ${isPos ? 'text-green-600' : 'text-slate-600'} `;
                    rightSpan.textContent = `${isPos ? '+' : ''}$${Math.abs(tx.amount).toFixed(2)} `;

                    li.append(leftDiv, rightSpan);
                    listEl.appendChild(li);
                });
            });
            unsubscribes.push(unsubTx);

            // Button Listeners
            card.querySelector('.btn-add-money').addEventListener('click', () => {
                document.getElementById('modal-transaction').classList.remove('hidden');
                document.getElementById('modal-kid-id').value = kid.id;
                document.getElementById('modal-transaction-type').value = 'add';
                document.getElementById('modal-transaction-title').innerText = `Add Money to ${kid.displayName} `;

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
                document.getElementById('modal-transaction-title').innerText = `Subtract from ${kid.displayName} `;

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

            card.querySelector('.btn-toggle-card').addEventListener('click', async (e) => {
                const isFrozen = e.target.dataset.frozen === 'true';
                const action = isFrozen ? 'Unfreeze' : 'Freeze';

                if (confirm(`Are you sure you want to ${action} ${kid.displayName} 's card?`)) {
                    try {
                        await DB.toggleCardFreeze(kid.id, !isFrozen);
                    } catch (err) {
                        alert(err.message);
                    }
                }
            });

            card.querySelector('.btn-toggle-quizzes').addEventListener('click', async (e) => {
                // Toggle
                const btn = e.currentTarget; // important to get the button, not the span
                const isEnabled = btn.dataset.enabled === 'true';
                try {
                    await DB.toggleQuizzes(kid.id, !isEnabled);
                    // UI updates automatically via listener
                } catch (err) {
                    console.error(err);
                }
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

        // Card Status
        const cardStatus = document.getElementById('kid-card-status');
        if (cardStatus) {
            if (kid.isCardFrozen) {
                cardStatus.className = "flex items-center gap-2 bg-red-500/20 text-red-400 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-4 border border-red-500/30";
                cardStatus.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span> Frozen`;
            } else {
                cardStatus.className = "flex items-center gap-2 bg-green-500/20 text-green-400 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-4 border border-green-500/30";
                cardStatus.innerHTML = `<span class="w-2 h-2 rounded-full bg-green-500"></span> Active`;
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
            item.className = 'p-4 flex justify-between items-center hover:bg-slate-50 transition-colors';

            // Create elements securely
            const leftDiv = document.createElement('div');
            leftDiv.className = 'flex items-center gap-3';

            const iconDiv = document.createElement('div');
            iconDiv.className = `p-2 rounded-lg ${isPos ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`;
            // Icons are static SVG, innerHTML is fine here if just SVG, but we can build it too or leave as is if no user content
            iconDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${isPos ? 'M12 4v16m8-8H4' : 'M20 12H4'}" /> 
                        </svg>`;

            const textDiv = document.createElement('div');

            const descP = document.createElement('p');
            descP.className = 'font-medium text-slate-800';
            descP.textContent = tx.description; // Secure

            const dateP = document.createElement('p');
            dateP.className = 'text-xs text-slate-400';
            dateP.textContent = date;

            textDiv.append(descP, dateP);
            leftDiv.append(iconDiv, textDiv);

            const rightSpan = document.createElement('span');
            rightSpan.className = `font-bold ${isPos ? 'text-green-600' : 'text-slate-900'}`;
            rightSpan.textContent = `${isPos ? '+' : ''}$${Math.abs(tx.amount).toFixed(2)}`;

            item.append(leftDiv, rightSpan);
            list.appendChild(item);
        });
    });
    unsubscribes.push(unsubTx);

    // Savings Goals
    const goalsList = document.getElementById('kid-goals-list');
    const unsubGoals = DB.subscribeToGoals(currentUser.uid, (goals) => {
        goalsList.innerHTML = '';
        if (goals.length === 0) {
            // Initial empty state (except the Add button is header)
            goalsList.innerHTML = `
                <div class="col-span-full text-center py-6 text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl">
                    <p>No goals yet. Start saving for something special!</p>
                </div>
            `;
            return;
        }

        goals.forEach(goal => {
            const percent = Math.min(100, (goal.currentAmount / goal.targetAmount) * 100).toFixed(0);

            const card = document.createElement('div');
            card.className = 'bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center text-center relative group';
            card.innerHTML = `
                <div class="text-4xl mb-2">${goal.icon}</div>
                <h4 class="font-bold text-slate-800 mb-1">${goal.name}</h4>
                <p class="text-xs text-slate-500 mb-3">$${goal.currentAmount.toFixed(0)} of $${goal.targetAmount}</p>
                
                <div class="w-full bg-slate-100 rounded-full h-2.5 mb-3 overflow-hidden">
                    <div class="bg-indigo-500 h-2.5 rounded-full transition-all duration-500" style="width: ${percent}%"></div>
                </div>

                <div class="flex gap-2 w-full mt-auto">
                    <button class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-bold py-2 rounded-lg transition-colors btn-contribute" data-id="${goal.id}">
                        Add Money
                    </button>
                </div>
                
                <button class="absolute top-2 right-2 text-slate-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity btn-delete-goal" data-id="${goal.id}" title="Delete Goal">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            `;
            goalsList.appendChild(card);

            // Listeners
            card.querySelector('.btn-contribute').addEventListener('click', () => {
                document.getElementById('modal-contribute-goal').classList.remove('hidden');
                document.getElementById('modal-contribute-goal-id').value = goal.id;
                document.getElementById('contribute-available-balance').innerText = savDisplay.innerText;
            });

            card.querySelector('.btn-delete-goal').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm("Delete this goal? Any money in it will move back to your Savings.")) {
                    try {
                        await DB.deleteSavingsGoal(currentUser.uid, goal.id);
                    } catch (err) {
                        alert(err.message);
                    }
                }
            });
        });
    });
    unsubscribes.push(unsubGoals);
}

// Quiz Helper
async function checkQuizAnswer(selectedIndex, quiz) {
    if (selectedIndex === quiz.correct) {
        // Correct
        document.getElementById('quiz-content').classList.add('hidden');
        document.getElementById('quiz-success').classList.remove('hidden');

        try {
            await DB.markQuizCompleted(currentUser.uid, quiz.id, quiz.reward);
        } catch (err) {
            console.error(err); // Silent fail or log
        }
    } else {
        // Wrong
        document.getElementById('quiz-content').classList.add('hidden');
        document.getElementById('quiz-fail').classList.remove('hidden');
    }
}
