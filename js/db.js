const DB = {
    // Utility to get Firestore instance
    get db() {
        return window.db;
    },

    // Get a user's role
    async getUserRole(uid) {
        const { doc, getDoc } = window.firebaseModules;
        if (!this.db) return null;
        try {
            const snap = await getDoc(doc(this.db, "users", uid));
            return snap.exists() ? snap.data().role : null;
        } catch (e) {
            console.error("Error getting user role:", e);
            return null;
        }
    },

    // Set a user's role (create user doc)
    async setUserRole(user, role) {
        const { doc, setDoc, serverTimestamp } = window.firebaseModules;
        await setDoc(doc(this.db, "users", user.uid), {
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            role: role,
            createdAt: serverTimestamp(),
            // Initialize balance/allowance only if kid
            ...(role === 'kid' ? { balance: 0, savingsBalance: 0, allowance: 0 } : {})
        }, { merge: true });
    },

    // Link a kid (by finding user with role=kid and given email) - simplified for MVP
    // In a real app we might use an invite system. Here we just assume the kid logs in first?
    // Or we add an entry to "users" by email? 
    // Firestore security rules usually prevent reading all users.
    // Enhanced flow: Parent creates a 'stub' kid user or we just query by email if allowed.
    // PROPOSAL: Parent adds kid email to their own `kids` array. Kid's profile tracks `parents`.
    // Let's go with: Single collection `users`. Parent updates their own doc to add kid email.
    // And we have a cloud function or client side logic to sync?
    // SIMPLEST: Query `users` where email == email AND role == 'kid'. 
    // This requires the kid to have logged in at least once.
    async findKidByEmail(email) {
        const { collection, query, where, getDocs } = window.firebaseModules;
        const q = query(collection(this.db, "users"), where("email", "==", email), where("role", "==", "kid"));
        const snap = await getDocs(q);
        if (snap.empty) return null;
        return { uid: snap.docs[0].id, ...snap.docs[0].data() };
    },

    async linkKidToParent(parentUid, kidUid) {
        const { doc, updateDoc, setDoc, arrayUnion } = window.firebaseModules;

        // 1. Update Kid's document (Redundant but good for data integrity)
        await updateDoc(doc(this.db, "users", kidUid), {
            parentIds: arrayUnion(parentUid),
            // Don't overwrite parentId if it's already set to someone else, to avoid breaking legacy query for the first parent.
            // But if we want to support switching "primary" parent, we might. 
            // For now, let's leave parentId alone if it exists.
        });

        // 2. Create a "relationship" document in the parent's subcollection
        // This avoids index requirements for querying "my kids"
        await setDoc(doc(this.db, "users", parentUid, "linked_kids", kidUid), {
            kidUid: kidUid,
            linkedAt: new Date()
        });
    },

    // Check and update savings withdrawal limit
    // Returns true if allowed, throws error if not
    async checkSavingsLimit(kidUid, transaction) {
        const { doc, serverTimestamp } = window.firebaseModules;
        const userRef = doc(this.db, "users", kidUid);
        const userDoc = await transaction.get(userRef);

        if (!userDoc.exists()) throw new Error("User not found");

        const data = userDoc.data();
        const now = new Date();
        const currentMonth = now.getMonth(); // 0-11
        const lastMonth = data.lastWithdrawalMonth;
        let count = data.savingsWithdrawalCount || 0;

        // Reset if new month
        if (lastMonth === undefined || lastMonth !== currentMonth) {
            count = 0;
            transaction.update(userRef, {
                savingsWithdrawalCount: 0,
                lastWithdrawalMonth: currentMonth
            });
        }

        if (count >= 4) {
            throw new Error("Savings withdrawal limit reached (4/month). You cannot spend or move from Savings until next month.");
        }

        // Increment count
        transaction.update(userRef, {
            savingsWithdrawalCount: count + 1,
            lastWithdrawalMonth: currentMonth
        });
    },

    // Update balance
    async updateBalance(kidUid, amount, description, accountType = 'checking') {
        const { doc, updateDoc, addDoc, collection, serverTimestamp, increment, runTransaction, getDoc } = window.firebaseModules;

        const balanceField = accountType === 'savings' ? 'savingsBalance' : 'balance';
        const accountName = accountType === 'savings' ? 'Savings' : 'Checking';
        const isSpending = parseFloat(amount) < 0;

        // CHECK FROZEN STATUS IF SPENDING
        if (isSpending) {
            const userSnap = await getDoc(doc(this.db, "users", kidUid));
            if (userSnap.exists() && userSnap.data().isCardFrozen) {
                throw new Error("Card is frozen. Ask your parent to unfreeze it.");
            }
        }

        // If spending from Savings, check limit
        if (accountType === 'savings' && isSpending) {
            await runTransaction(this.db, async (transaction) => {
                await this.checkSavingsLimit(kidUid, transaction);

                // Add transaction
                const newTxRef = doc(collection(this.db, "transactions"));
                transaction.set(newTxRef, {
                    kidId: kidUid,
                    amount: parseFloat(amount),
                    description: `${description} (${accountName})`,
                    timestamp: serverTimestamp(),
                    accountType: accountType
                });

                // Update balance
                transaction.update(doc(this.db, "users", kidUid), {
                    [balanceField]: increment(parseFloat(amount))
                });
            });
        } else {
            // Normal update (Checking or Adding money)
            // Add transaction
            await addDoc(collection(this.db, "transactions"), {
                kidId: kidUid,
                amount: parseFloat(amount), // can be negative
                description: `${description} (${accountName})`,
                timestamp: serverTimestamp(),
                accountType: accountType
            });

            // Update balance
            await updateDoc(doc(this.db, "users", kidUid), {
                [balanceField]: increment(parseFloat(amount))
            });
        }
    },

    // Toggle Card Freeze
    async toggleCardFreeze(kidUid, shouldFreeze) {
        const { doc, updateDoc } = window.firebaseModules;
        await updateDoc(doc(this.db, "users", kidUid), {
            isCardFrozen: shouldFreeze
        });
    },

    // Toggle Quizzes (Parent Control)
    async toggleQuizzes(kidUid, enabled) {
        const { doc, updateDoc } = window.firebaseModules;
        await updateDoc(doc(this.db, "users", kidUid), {
            quizzesEnabled: enabled
        });
    },

    // Complete Quiz (Reward + Mark as done)
    async markQuizCompleted(kidUid, quizId, rewardAmount) {
        const { doc, runTransaction, increment, arrayUnion, serverTimestamp, collection } = window.firebaseModules;

        await runTransaction(this.db, async (transaction) => {
            const userRef = doc(this.db, "users", kidUid);
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists()) throw new Error("User not found");
            const userData = userDoc.data();

            // Check if already completed
            if (userData.completedQuizzes && userData.completedQuizzes.includes(quizId)) {
                throw new Error("You already completed this quiz!");
            }

            // Check if quizzes are enabled
            if (userData.quizzesEnabled === false) { // Strict check for false, undefined defaults to true
                throw new Error("Quizzes are currently disabled by your parent.");
            }

            // Grant Reward
            transaction.update(userRef, {
                balance: increment(rewardAmount),
                completedQuizzes: arrayUnion(quizId)
            });

            // Add Transaction Record
            const newTxRef = doc(collection(this.db, "transactions"));
            transaction.set(newTxRef, {
                kidId: kidUid,
                amount: rewardAmount,
                description: `Quiz Reward: ${quizId}`,
                timestamp: serverTimestamp(),
                accountType: 'checking'
            });
        });
    },

    // Internal Transfer (Checking <-> Savings)
    async transferInternal(kidUid, fromType, toType, amount) {
        const { doc, runTransaction, collection, serverTimestamp, increment } = window.firebaseModules;

        await runTransaction(this.db, async (transaction) => {
            const userRef = doc(this.db, "users", kidUid);
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists()) throw new Error("User not found");

            const fromField = fromType === 'savings' ? 'savingsBalance' : 'balance';
            const toField = toType === 'savings' ? 'savingsBalance' : 'balance';

            const currentBal = userDoc.data()[fromField] || 0;
            if (currentBal < amount) {
                throw new Error(`Insufficient funds in ${fromType}`);
            }

            // If moving FROM Savings, check limit
            if (fromType === 'savings') {
                await this.checkSavingsLimit(kidUid, transaction);
            }

            transaction.update(userRef, {
                [fromField]: increment(-amount),
                [toField]: increment(amount)
            });

            // Record Transaction
            const txCol = collection(this.db, "transactions");
            const newTxRef = doc(txCol);

            transaction.set(newTxRef, {
                kidId: kidUid,
                amount: 0, // Net change to total wealth is 0, or we could log individual interactions. 
                // Let's log it as a generic 'info' transaction or two entries?
                // For simplicity in the log list: "Transferred $X to Savings"
                description: `Transferred $${amount} from ${fromType} to ${toType}`,
                timestamp: serverTimestamp(),
                type: 'transfer_internal'
            });
        });
    },

    // Transfer money between kids
    async transferMoney(fromKidUid, toEmail, amount, desc) {
        const { doc, runTransaction, collection, serverTimestamp, increment } = window.firebaseModules;

        // 1. Find recipient
        const toKid = await this.findKidByEmail(toEmail);
        if (!toKid) throw new Error("Recipient email not found. Make sure they have a Kid account.");
        if (toKid.uid === fromKidUid) throw new Error("You cannot send money to yourself!");

        // 2. Run transaction
        await runTransaction(this.db, async (transaction) => {
            const fromRef = doc(this.db, "users", fromKidUid);
            const toRef = doc(this.db, "users", toKid.uid);

            const fromDoc = await transaction.get(fromRef);
            if (!fromDoc.exists()) throw new Error("Sender not found");

            const currentBal = fromDoc.data().balance || 0;
            if (currentBal < amount) {
                throw new Error("Insufficient funds");
            }

            // Deduct
            transaction.update(fromRef, { balance: increment(-amount) });
            // Add
            transaction.update(toRef, { balance: increment(amount) });

            // Record Transactions
            const txCol = collection(this.db, "transactions");
            const newTxFromRef = doc(txCol);
            const newTxToRef = doc(txCol);

            transaction.set(newTxFromRef, {
                kidId: fromKidUid,
                amount: -amount,
                description: `Sent to ${toKid.displayName || toEmail}: ${desc}`,
                timestamp: serverTimestamp(),
                relatedUserId: toKid.uid
            });

            transaction.set(newTxToRef, {
                kidId: toKid.uid,
                amount: amount,
                description: `Received from ${fromDoc.data().displayName || 'Friend'}: ${desc}`,
                timestamp: serverTimestamp(),
                relatedUserId: fromKidUid
            });
        });
    },

    // Get kids linked to this parent
    async getKids(parentUid) {
        const { collection, query, where, getDocs, doc, getDoc } = window.firebaseModules;

        const kidsMap = new Map();

        // Helper to add kid to map
        const addKid = (data) => {
            if (data && data.id && !kidsMap.has(data.id)) {
                kidsMap.set(data.id, data);
            }
        };

        try {
            // Source 1: Subcollection "linked_kids" (Robust, No Index needed)
            const linkedSnap = await getDocs(collection(this.db, "users", parentUid, "linked_kids"));
            const linkedKidIds = linkedSnap.docs.map(d => d.id);

            // Fetch actual kid profiles
            for (const kidId of linkedKidIds) {
                const kidSnap = await getDoc(doc(this.db, "users", kidId));
                if (kidSnap.exists()) {
                    addKid({ id: kidSnap.id, ...kidSnap.data() });
                }
            }

            // Source 2: Legacy 'parentId' field
            // Useful for kids linked before the update
            const qLegacy = query(collection(this.db, "users"), where("parentId", "==", parentUid));
            const snapLegacy = await getDocs(qLegacy);
            snapLegacy.forEach(d => addKid({ id: d.id, ...d.data() }));

            // Source 3: Array 'parentIds' (Might fail if no index)
            // We try this last and catch errors silently
            try {
                const qArray = query(collection(this.db, "users"), where("parentIds", "array-contains", parentUid));
                const snapArray = await getDocs(qArray);
                snapArray.forEach(d => addKid({ id: d.id, ...d.data() }));
            } catch (indexErr) {
                // Ignore index errors, we have fallbacks
                console.log("Skipping array-contains query (likely missing index)");
            }

            return Array.from(kidsMap.values());

        } catch (e) {
            console.error("Error fetching kids:", e);
            return [];
        }
    },

    // Realtime listener for a kid's profile (balance)
    subscribeToKid(kidUid, cb) {
        const { doc, onSnapshot } = window.firebaseModules;
        return onSnapshot(doc(this.db, "users", kidUid), (snap) => {
            if (snap.exists()) cb({ id: snap.id, ...snap.data() });
        });
    },

    // Realtime listener for transactions
    subscribeToTransactions(kidUid, cb) {
        const { collection, query, where, orderBy, limit, onSnapshot } = window.firebaseModules;
        // Note: orderBy requires an index if mixed with where(). 
        // For MVP without index creation, we might skip orderBy in the query and sort client side.
        // Let's try client side sort to avoid index errors for the user.
        const q = query(
            collection(this.db, "transactions"),
            where("kidId", "==", kidUid)
        );
        return onSnapshot(q, (snap) => {
            const txs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Sort desc
            txs.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
            cb(txs);
        });
    }
},

    // --- SAVINGS GOALS ---

    // Add a new savings goal
    async createSavingsGoal(kidUid, name, targetAmount, icon = '🎯') {
        const { collection, addDoc, serverTimestamp } = window.firebaseModules;
        await addDoc(collection(this.db, "users", kidUid, "goals"), {
            name,
            targetAmount: parseFloat(targetAmount),
            currentAmount: 0,
            icon,
            createdAt: serverTimestamp()
        });
    },

        // Delete a savings goal (money returns to Savings)
        async deleteSavingsGoal(kidUid, goalId) {
    const { doc, getDoc, runTransaction, increment } = window.firebaseModules;

    await runTransaction(this.db, async (transaction) => {
        const goalRef = doc(this.db, "users", kidUid, "goals", goalId);
        const goalDoc = await transaction.get(goalRef);

        if (!goalDoc.exists()) throw new Error("Goal not found");

        const amountToReturn = goalDoc.data().currentAmount || 0;

        // Delete goal
        transaction.delete(goalRef);

        // Return funds to Savings Balance if > 0
        if (amountToReturn > 0) {
            const userRef = doc(this.db, "users", kidUid);
            transaction.update(userRef, {
                savingsBalance: increment(amountToReturn)
            });
        }
    });
},

    // Move money from Savings -> Goal (or Goal -> Savings if negative)
    async contributeToGoal(kidUid, goalId, amount) {
    const { doc, runTransaction, increment } = window.firebaseModules;

    await runTransaction(this.db, async (transaction) => {
        const userRef = doc(this.db, "users", kidUid);
        const goalRef = doc(this.db, "users", kidUid, "goals", goalId);

        const userDoc = await transaction.get(userRef);
        const goalDoc = await transaction.get(goalRef);

        if (!userDoc.exists()) throw new Error("User not found");
        if (!goalDoc.exists()) throw new Error("Goal not found");

        const savingsBal = userDoc.data().savingsBalance || 0;
        const currentGoalAmount = goalDoc.data().currentAmount || 0;

        // Check sufficient funds (Source depends on direction)
        if (amount > 0) {
            // Moving Savings -> Goal
            if (savingsBal < amount) throw new Error("Insufficient savings for this contribution.");
        } else {
            // Moving Goal -> Savings (amount is negative)
            if (currentGoalAmount < Math.abs(amount)) throw new Error("Not enough money in this goal to withdraw.");
        }

        // Execute Transfer
        transaction.update(userRef, {
            savingsBalance: increment(-amount)
        });

        transaction.update(goalRef, {
            currentAmount: increment(amount)
        });
    });
},

// Listen to goals
subscribeToGoals(kidUid, cb) {
    const { collection, query, orderBy, onSnapshot } = window.firebaseModules;
    const q = query(collection(this.db, "users", kidUid, "goals"), orderBy("createdAt", "asc"));
    return onSnapshot(q, (snap) => {
        const goals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        cb(goals);
    });
}
};
