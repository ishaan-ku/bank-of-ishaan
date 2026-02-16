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
            ...(role === 'kid' ? { balance: 0, allowance: 0 } : {})
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

    // Update balance
    async updateBalance(kidUid, amount, description) {
        const { doc, updateDoc, addDoc, collection, serverTimestamp, increment } = window.firebaseModules;

        // Add transaction
        await addDoc(collection(this.db, "transactions"), {
            kidId: kidUid,
            amount: parseFloat(amount), // can be negative
            description: description,
            timestamp: serverTimestamp()
        });

        // Update balance
        await updateDoc(doc(this.db, "users", kidUid), {
            balance: increment(parseFloat(amount))
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
};
