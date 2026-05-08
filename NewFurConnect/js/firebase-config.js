const firebaseConfig = {
  apiKey: "AIzaSyAzeuh8DNrAkCD-0YdECwiHeB30-kLmMr8",
  authDomain: "furconnect-website.firebaseapp.com",
  projectId: "furconnect-website",
  storageBucket: "furconnect-website.firebasestorage.app",
  messagingSenderId: "816990132302",
  appId: "1:816990132302:web:7ec14fc9a126fde580cb1f"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();
window.db = db;