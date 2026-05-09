const firebaseConfig = {
  apiKey: "AIzaSyAzeuh8DNrAkCD-0YdECwiHeB30-kLmMr8",
  authDomain: "furconnect-website.firebaseapp.com",
  projectId: "furconnect-website",
  storageBucket: "furconnect-website.firebasestorage.app",
  messagingSenderId: "816990132302",
  appId: "1:816990132302:web:7ec14fc9a126fde580cb1f"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
window.db = db;
window.firebase = firebase;

if (typeof firebase.storage === "function") {
  window.storage = firebase.storage();
} else {
  window.storage = null;
  console.warn("Firebase Storage is not loaded on this page. Firestore will still work.");
}

console.log("Firebase config loaded.");
console.log("Firestore ready:", !!window.db);
console.log("Storage ready:", !!window.storage);