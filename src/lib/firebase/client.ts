import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
};

export function isFirebaseConfigured() {
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

function firebaseApp() {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase client configuration is missing. Set the NEXT_PUBLIC_FIREBASE_* variables.');
  }
  return getApps().length ? getApp() : initializeApp(config);
}

export function firebaseAuth() {
  return getAuth(firebaseApp());
}

export function firestoreDb() {
  return getFirestore(firebaseApp());
}

export function firebaseProjectId() {
  if (!config.projectId) throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is missing.');
  return config.projectId;
}
