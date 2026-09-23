// YoCapi App - Authentication Module (Firebase)
// Handles admin login/signup for GitHub Pages + Firebase Auth

const ADMIN_PATHS = ['/admin/', '/admin/index.html'];

function isAdminPage() {
  const path = window.location.pathname;
  return ADMIN_PATHS.some(p => path.endsWith(p) || path === p);
}

// Wrap onAuthStateChanged in a promise for initial check
function getAuthState() {
  return new Promise((resolve) => {
    const unsubscribe = firebaseAuth.onAuthStateChanged(user => {
      unsubscribe();
      resolve(user);
    });
  });
}

async function checkAuth() {
  const user = await getAuthState();
  if (!user && isAdminPage() && !window.location.pathname.endsWith('login.html')) {
    window.location.href = 'login.html';
    return null;
  }
  return user ? { user } : null;
}

async function signIn(email, password) {
  try {
    const credential = await firebaseAuth.signInWithEmailAndPassword(email, password);
    return { data: { user: credential.user } };
  } catch (e) {
    let msg = 'Login failed';
    if (e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
      msg = 'Correo o contraseña incorrectos';
    }
    return { error: msg };
  }
}

async function signUp(email, password) {
  try {
    const credential = await firebaseAuth.createUserWithEmailAndPassword(email, password);
    return { data: { user: credential.user } };
  } catch (e) {
    return { error: e.message };
  }
}

async function signOut() {
  await firebaseAuth.signOut();
  if (isAdminPage()) {
    window.location.href = 'login.html';
  }
}

function onAuthChange(callback) {
  firebaseAuth.onAuthStateChanged(user => {
    callback('TOKEN_CHECK', user ? { access_token: user.uid } : null);
  });
}

window.checkAuth = checkAuth;
window.signIn = signIn;
window.signUp = signUp;
window.signOut = signOut;
window.onAuthChange = onAuthChange;
