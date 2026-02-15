// Test Mode Logic
const TestMode = {
    isActive: false,
    balance: 0,
    history: [],

    init() {
        const btn = document.getElementById('btn-test-mode');
        if (btn) {
            btn.addEventListener('click', () => this.start());
        }

        // Logic Controls
        document.getElementById('btn-test-add-money').addEventListener('click', () => this.update(5, "Manual Deposit"));
        document.getElementById('btn-test-sub-money').addEventListener('click', () => this.update(-5, "Manual Withdrawal"));
        document.getElementById('btn-test-allowance').addEventListener('click', () => this.update(10, "Weekly Allowance"));

        // Global Key Listener for ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === "Escape" && this.isActive) {
                this.stop();
            }
        });
    },

    start() {
        this.isActive = true;
        this.balance = 0;
        this.history = [];

        // Hide regular app views
        document.getElementById('nav-bar').classList.add('hidden');
        document.querySelectorAll('main > div').forEach(el => el.classList.add('hidden'));

        // Show Test View
        document.getElementById('view-test-mode').classList.remove('hidden');

        // Render initial state
        this.render();
    },

    stop() {
        this.isActive = false;
        document.getElementById('view-test-mode').classList.add('hidden');
        document.getElementById('view-login').classList.remove('hidden');
        // Reset to initial state (login view)
    },

    update(amount, description) {
        this.balance += amount;
        this.history.unshift({
            amount: amount,
            description: description,
            time: new Date().toLocaleTimeString()
        });
        this.render();
    },

    render() {
        // Update Parent View
        document.getElementById('test-parent-view-balance').innerText = `$${this.balance.toFixed(2)}`;

        // Update Kid View
        document.getElementById('test-kid-balance').innerText = `$${this.balance.toFixed(2)}`;

        // Update History
        const list = document.getElementById('test-activity-log');
        list.innerHTML = '';
        if (this.history.length === 0) {
            list.innerHTML = '<li class="p-4 text-center text-slate-400 italic">No activity yet.</li>';
        } else {
            this.history.forEach(item => {
                const li = document.createElement('li');
                li.className = 'p-3 flex justify-between items-center';
                const isPos = item.amount > 0;
                li.innerHTML = `
                    <div>
                        <span class="font-medium text-slate-700">${item.description}</span>
                        <span class="text-xs text-slate-400 block">${item.time}</span>
                    </div>
                    <span class="font-bold ${isPos ? 'text-green-600' : 'text-red-500'}">
                        ${isPos ? '+' : ''}$${Math.abs(item.amount).toFixed(2)}
                    </span>
                `;
                list.appendChild(li);
            });
        }
    }
};

// Initialize when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    TestMode.init();
});
