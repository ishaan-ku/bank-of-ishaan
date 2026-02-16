const Auth = {
    user: null,
    role: null,

    async signIn() {
        console.log("Starting Sign In (Popup Mode)...");
        const { getAuth, signInWithPopup, GoogleAuthProvider, setPersistence, browserLocalPersistence } = window.firebaseModules;
        const auth = getAuth();
        const provider = new GoogleAuthProvider();

        try {
            console.log("Setting persistence...");
            await setPersistence(auth, browserLocalPersistence);
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Login failed", error);
            if (error.code === 'auth/popup-blocked') {
                alert("Login Popup Blocked!\n\nPlease look for a 'Pop-up blocked' icon in your address bar (usually top right), click it, and select 'Always allow'. Then try again.");
            } else {
                alert("Login failed: " + error.message);
            }
        }
    },

    async signOut() {
        const { getAuth, signOut } = window.firebaseModules;
        const auth = getAuth();
        await signOut(auth);
        window.location.reload();
    },

    init(onUserChange) {
        // Wait for modules then init
        const checkModules = setInterval(() => {
            if (window.firebaseModules && window.firebaseConfig) {
                clearInterval(checkModules);

                const { initializeApp } = window.firebaseModules;
                const { getAuth, onAuthStateChanged } = window.firebaseModules;
                const { getFirestore } = window.firebaseModules;

                try {
                    const app = initializeApp(window.firebaseConfig);
                    window.db = getFirestore(app);
                    const auth = getAuth(app);

                    // Check for redirect result (optional cleanup if switching back to popup, but keeping it doesn't hurt)
                    const { getRedirectResult } = window.firebaseModules;
                    getRedirectResult(auth).catch((error) => console.error(error));

                    onAuthStateChanged(auth, async (user) => {
                        this.user = user;
                        if (user) {
                            // Check role
                            this.role = await DB.getUserRole(user.uid);
                        } else {
                            this.role = null;
                        }
                        onUserChange(user, this.role);
                    });
                } catch (e) {
                    console.error("Init Error: " + e.message);
                }
            }
        }, 100);
    }
};
