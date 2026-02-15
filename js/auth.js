const Auth = {
    user: null,
    role: null,

    log(msg) {
        console.log(msg);
        const el = document.getElementById('auth-debug-log');
        if (el) {
            el.classList.remove('hidden');
            el.innerText += msg + '\n';
        }
    },

    async signIn() {
        this.log("Starting Sign In (Popup Mode)...");
        const { getAuth, signInWithPopup, GoogleAuthProvider, setPersistence, browserLocalPersistence } = window.firebaseModules;
        const auth = getAuth();
        const provider = new GoogleAuthProvider();

        try {
            this.log("Setting persistence...");
            await setPersistence(auth, browserLocalPersistence);
            await signInWithPopup(auth, provider);
        } catch (error) {
            this.log("Login Error: " + error.code);
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
        this.log = this.log.bind(this);
        // Wait for modules then init
        const checkModules = setInterval(() => {
            if (window.firebaseModules && window.firebaseConfig) {
                clearInterval(checkModules);
                this.log("Firebase modules loaded.");

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
                            this.log("Redirect success! User: " + result.user.email);
                        } else {
                            this.log("No redirect result found.");
                        }
                    }).catch((error) => {
                        this.log("Redirect error: " + error.message);
                    });

                    onAuthStateChanged(auth, async (user) => {
                        this.user = user;
                        if (user) {
                            this.log("Auth State: Logged In as " + user.email);
                            // Check role
                            this.role = await DB.getUserRole(user.uid);
                            this.log("Role: " + (this.role || "None"));
                        } else {
                            this.log("Auth State: Signed Out");
                            this.role = null;
                        }
                        onUserChange(user, this.role);
                    });
                } catch (e) {
                    this.log("Init Error: " + e.message);
                }
            }
        }, 100);
    }
};
