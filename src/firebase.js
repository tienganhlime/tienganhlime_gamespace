import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getDatabase, ref, set, onValue, push, get, remove } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAQ3Uob61382F1FPHcXE5iwvSIlKfdMn58",
  authDomain: "lime-game.firebaseapp.com",
  databaseURL: "https://lime-game-default-rtdb.firebaseio.com",
  projectId: "lime-game",
  storageBucket: "lime-game.firebasestorage.app",
  messagingSenderId: "109036292430",
  appId: "1:109036292430:web:28b173ae5a222021dd761f",
  measurementId: "G-0S9XSW6F56"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

export { database, ref, set, onValue, push, get, remove };
export const analytics = getAnalytics(app);