'use client';
import { getApps, initializeApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup, signOut, type Auth } from 'firebase/auth';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken, type AppCheck } from 'firebase/app-check';
let services: { auth: Auth; appCheck: AppCheck } | undefined;
export function firebaseServices() {
  if (typeof window === 'undefined') throw new Error('BROWSER_ONLY');
  if (services) return services;
  const config = { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID };
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (Object.values(config).some(v => !v) || !siteKey) throw new Error('FIREBASE_NOT_CONFIGURED');
  if (!config.projectId!.startsWith('wmgj-hml-jfn-')) throw new Error('HOMOLOGATION_PROJECT_REQUIRED');
  const app = getApps().find(a => a.name === 'jfn-auditoria') ?? initializeApp(config, 'jfn-auditoria');
  const auth = initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  const appCheck = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
  services = { auth, appCheck }; return services;
}
export async function login() {
  const { auth } = firebaseServices();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return (await signInWithPopup(auth, provider)).user;
}
export async function logout() { if (services) await signOut(services.auth); }
export async function authorizedHeaders() {
  const { auth, appCheck } = firebaseServices();
  if (!auth.currentUser) throw new Error('AUTH_REQUIRED');
  const [idToken, attestation] = await Promise.all([auth.currentUser.getIdToken(), getToken(appCheck)]);
  return { Authorization: `Bearer ${idToken}`, 'X-Firebase-AppCheck': attestation.token };
}
