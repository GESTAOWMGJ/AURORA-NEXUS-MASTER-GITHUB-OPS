import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const app = getApps()[0] ?? initializeApp();

export const auroraAuth = getAuth(app);
export const auroraDb = getFirestore(app);
