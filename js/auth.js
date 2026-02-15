const Auth = {
    user: null,
    role: null,

    async signIn() {
        const { getAuth, signInWithRedirect, GoogleAuthProvider } = window.firebaseModules;
        const auth = getAuth();
        const provider = new GoogleAuthProvider();
        try {
            await signInWithRedirect(auth, provider);
        } catch (error) {
            console.error("Login failed", error);
            alert("Login failed: " + error.message);
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

                    // Check for redirect result
                    const { getRedirectResult } = window.firebaseModules;
                    getRedirectResult(auth).then((result) => {
                        if (result) {
                            console.log("Redirect login success", result.user);
                        }
                    }).catch((error) => {
                        console.error("Redirect login error", error);
                        alert("Login failed: " + error.message);
                    });

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
                    console.error("Firebase Init Error:", e);
                }
            }
        }, 100);
    }
};
