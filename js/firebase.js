// YoCapi App - Firebase Client (Compat SDK)

const firebaseConfig = {
  apiKey: "AIzaSyChUyg_OQDL88AfuzJnVxQoGkf7YH6i_SI",
  authDomain: "capilogs-4f346.firebaseapp.com",
  databaseURL: "https://capilogs-4f346-default-rtdb.firebaseio.com",
  projectId: "capilogs-4f346",
  storageBucket: "capilogs-4f346.firebasestorage.app",
  messagingSenderId: "527180653764",
  appId: "1:527180653764:web:384d5fc9cf4e1cd007d591",
  measurementId: "G-VN3Z649DMC"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const auth = firebase.auth();

// --- Saved Logs (Public) ---

async function getSavedLogsList(channel) {
  try {
    const snap = await db.collection("saved_logs")
      .where("channel", "==", channel.toLowerCase())
      .get();
      
    const tree = {};
    snap.forEach((docSnap) => {
      const row = docSnap.data();
      const [year, month, day] = row.date.split('-');
      if (!year || !month) return;
      if (!tree[year]) tree[year] = {};
      if (!tree[year][month]) tree[year][month] = [];
      if (day) tree[year][month].push(row.date);
    });
    
    for (const y in tree) {
      for (const m in tree[y]) {
        tree[y][m].sort((a, b) => b.localeCompare(a));
      }
    }
    
    return tree;
  } catch (e) {
    console.error('[Firebase] Error fetching saved logs list:', e.message);
    return {};
  }
}

async function getSavedLog(channel, date) {
  try {
    const docId = `${channel.toLowerCase()}_${date}`;
    const docSnap = await db.collection("saved_logs").doc(docId).get();
    
    if (docSnap.exists) {
      const data = docSnap.data();
      let messages = [];
      
      if (data.messages_compressed) {
        // Decompress Pako Blob/Bytes
        const uint8array = data.messages_compressed.toUint8Array();
        const jsonString = pako.inflate(uint8array, { to: 'string' });
        messages = JSON.parse(jsonString);
      } else if (data.messages) {
        // Fallback for uncompressed data (just in case)
        messages = data.messages;
      }
      
      return { messages };
    }
    return null;
  } catch (e) {
    console.error('[Firebase] Error fetching saved log:', e.message);
    return null;
  }
}

async function saveLogsLocallySupabase(channel, date, messages) {
  try {
    const docId = `${channel.toLowerCase()}_${date}`;
    
    // Compress messages to fit in Firestore 1MB limit
    const jsonString = JSON.stringify(messages);
    const compressedUint8 = pako.deflate(jsonString);
    const blob = firebase.firestore.Blob.fromUint8Array(compressedUint8);
    
    await db.collection("saved_logs").doc(docId).set({
      channel: channel.toLowerCase(),
      date: date,
      messages_compressed: blob
    }, { merge: true });
    
    return { ok: true, saved: messages.length };
  } catch (e) {
    console.error('[Firebase] Error saving logs:', e.message);
    return { ok: false, error: e.message };
  }
}

async function deleteLogDay(channel, date) {
  try {
    const docId = `${channel.toLowerCase()}_${date}`;
    await db.collection("saved_logs").doc(docId).delete();
    return { ok: true };
  } catch (e) {
    console.error('[Firebase] Error deleting log day:', e.message);
    return { ok: false, error: e.message };
  }
}

async function checkCompileStatus(channel, month) {
  try {
    const snap = await db.collection("saved_logs")
      .where("channel", "==", channel.toLowerCase())
      .get();
      
    let count = 0;
    snap.forEach((docSnap) => {
      const row = docSnap.data();
      if (row.date.startsWith(month + '-')) count++;
    });
    
    if (count === 0) return false;
    
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    return count >= daysInMonth;
  } catch (e) {
    return false;
  }
}

// --- Search History (Public) ---

async function getSearchHistory(limit_count = 50) {
  try {
    const snap = await db.collection("search_history")
      .orderBy("search_count", "desc")
      .limit(limit_count)
      .get();
      
    const results = [];
    snap.forEach((docSnap) => {
      results.push(docSnap.data());
    });
    return results;
  } catch (e) {
    console.error('[Firebase] Error fetching search history:', e.message);
    return [];
  }
}

async function upsertSearchHistory(username, displayName) {
  try {
    const docId = username.toLowerCase();
    const docRef = db.collection("search_history").doc(docId);
    
    await db.runTransaction(async (transaction) => {
      const docSnap = await transaction.get(docRef);
      if (docSnap.exists) {
        transaction.update(docRef, {
          search_count: (docSnap.data().search_count || 0) + 1,
          display_name: displayName
        });
      } else {
        transaction.set(docRef, {
          username: username.toLowerCase(),
          display_name: displayName,
          search_count: 1
        });
      }
    });
  } catch (e) {
    console.error('[Firebase] Error updating search history:', e.message);
  }
}

// --- Emote Cache ---

async function getEmoteCache() {
  try {
    const snap = await db.collection("emote_cache").get();
    const map = {};
    snap.forEach((docSnap) => {
      const row = docSnap.data();
      map[row.name] = row.emote_id ? { url: row.url, id: row.emote_id } : row.url;
    });
    return map;
  } catch (e) {
    console.error('[Firebase] Error fetching emote cache:', e.message);
    return {};
  }
}

// --- Twitch Auth (Admin only) ---

async function getAdminTwitchConfig() {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    
    const docSnap = await db.collection("admin_profiles").doc(user.uid).get();
    if (docSnap.exists) {
      return docSnap.data();
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function saveAdminTwitchConfig(clientId, clientSecret) {
  try {
    const user = auth.currentUser;
    if (!user) return { ok: false, error: 'Not authenticated' };
    
    await db.collection("admin_profiles").doc(user.uid).set({
      twitch_client_id: clientId,
      twitch_client_secret: clientSecret
    }, { merge: true });
    
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Expose globally
window.getSavedLogsList = getSavedLogsList;
window.getSavedLog = getSavedLog;
window.saveLogsLocallySupabase = saveLogsLocallySupabase; // Keeps old name for compatibility
window.deleteLogDay = deleteLogDay;
window.checkCompileStatus = checkCompileStatus;
window.getSearchHistory = getSearchHistory;
window.upsertSearchHistory = upsertSearchHistory;
window.getEmoteCache = getEmoteCache;
window.getAdminTwitchConfig = getAdminTwitchConfig;
window.saveAdminTwitchConfig = saveAdminTwitchConfig;
window.firebaseAuth = auth;
