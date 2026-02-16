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
        const { doc, updateDoc, arrayUnion } = window.firebaseModules;
        await updateDoc(doc(this.db, "users", kidUid), {
            parentIds: arrayUnion(parentUid),
            parentId: parentUid // Keep for backward compat if needed, but array is primary now
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

    // Get kids linked to this parent
    async getKids(parentUid) {
        const { collection, query, where, getDocs } = window.firebaseModules;

        // Try to query by array (new way)
        // If security rules or index issues arise, we might need a fallback, 
        // but for this "No-Build" prototype, we assume we can query.
        // Note: array-contains requires an index sometimes, but usually works for basic fields.

        // Strategy: Query for 'parentIds' array-contains parentUid.
        // Fallback: Query for 'parentId' == parentUid (legacy).

        // We can't do OR queries easily without complex setup.
        // Let's just do two queries and merge client side if necessary, 
        // OR just migrate everyone to have parentIds. 
        // Since we update parentId AND parentIds on link, let's try to query both?
        // Actually, let's just use the array query. If it fails, we catch.

        try {
            const q = query(collection(this.db, "users"), where("parentIds", "array-contains", parentUid));
            const snap = await getDocs(q);
            // Also check legacy
            const qLegacy = query(collection(this.db, "users"), where("parentId", "==", parentUid));
            const snapLegacy = await getDocs(qLegacy);

            const kids = new Map();
            snap.docs.forEach(d => kids.set(d.id, { id: d.id, ...d.data() }));
            snapLegacy.docs.forEach(d => kids.set(d.id, { id: d.id, ...d.data() }));

            return Array.from(kids.values());
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
