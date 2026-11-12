import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoDirectory = path.resolve(scriptDirectory, '..');
const projectConfig = JSON.parse(await readFile(path.join(repoDirectory, '.firebaserc'), 'utf8'));
const projectId = projectConfig.projects?.default;
const confirmation = process.env.FIREBASE_SEED_CONFIRM_PROJECT;
const configuredCredentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
const defaultCredentialsPath = path.join(homedir(), '.firebase', `${projectId}-service-account.json`);
const credentialsPath = configuredCredentialsPath
  ? path.resolve(configuredCredentialsPath)
  : defaultCredentialsPath;

if (!projectId) throw new Error('No default Firebase project is configured in .firebaserc.');
if (confirmation !== projectId) {
  throw new Error(`Refusing to seed. Set FIREBASE_SEED_CONFIRM_PROJECT=${projectId} to confirm the target project.`);
}
let serviceAccount;
try {
  serviceAccount = JSON.parse(await readFile(credentialsPath, 'utf8'));
} catch (error) {
  if (error.code === 'ENOENT') {
    throw new Error(
      `Firebase Admin credentials were not found. Download a service-account JSON from Firebase Console > Project settings > Service accounts, then save it as ${defaultCredentialsPath}. You may override this with GOOGLE_APPLICATION_CREDENTIALS in .env.local.`,
    );
  }
  throw error;
}
if (serviceAccount.type !== 'service_account' || serviceAccount.project_id !== projectId) {
  throw new Error(`The service-account file must belong to Firebase project ${projectId}.`);
}

const seed = JSON.parse(await readFile(path.join(scriptDirectory, 'seed-users.json'), 'utf8'));
const seedPassword = process.env.FIREBASE_SEED_PASSWORD;
if (!Array.isArray(seed.users) || seed.users.length !== 3 || !seedPassword) {
  throw new Error('scripts/seed-users.json must define exactly three users and FIREBASE_SEED_PASSWORD must be set in .env.local.');
}

const app = initializeApp({ credential: cert(serviceAccount), projectId });
const auth = getAuth(app);
const db = getFirestore(app);
const actions = [];
const createdAuthUsers = [];
const createdProfiles = [];
const updatedExistingPasswords = [];

try {
  // Preflight the whole batch before writing any account or profile.
  for (const user of seed.users) {
    let authUser;
    try {
      authUser = await auth.getUserByEmail(user.email);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }

    if (authUser) {
      const profileRef = db.collection('userProfiles').doc(authUser.uid);
      const profileSnapshot = await profileRef.get();
      if (profileSnapshot.exists) {
        const existingProfile = profileSnapshot.data();
        const matchesSeed = existingProfile.email?.toLowerCase() === user.email.toLowerCase()
          && existingProfile.role === user.profile.role
          && existingProfile.status === user.profile.status
          && existingProfile.isActive === user.profile.isActive;
        if (!matchesSeed) {
          throw new Error(`Existing userProfiles data for ${user.email} does not match the seed roles/status. No data was changed.`);
        }
        actions.push({ type: 'skip', user, authUser });
      } else {
        actions.push({ type: 'repair', user, authUser, profileRef });
      }
      continue;
    }

    const orphanProfiles = await db.collection('userProfiles').where('email', '==', user.email).limit(1).get();
    if (!orphanProfiles.empty) {
      throw new Error(`A userProfiles record already exists for ${user.email} without a matching Auth user. No data was changed.`);
    }
    actions.push({ type: 'create', user });
  }

  // Create missing accounts and profiles. Repair an existing Auth account only
  // when its profile is absent; profiles with existing role/status are preserved.
  for (const action of actions) {
    const { user } = action;
    if (action.type === 'skip') continue;

    let uid;
    if (action.type === 'create') {
      const authUser = await auth.createUser({
        email: user.email,
        password: seedPassword,
        displayName: user.displayName,
        emailVerified: false,
        disabled: false,
      });
      uid = authUser.uid;
      createdAuthUsers.push(uid);
    } else {
      uid = action.authUser.uid;
    }

    const profileRef = action.profileRef ?? db.collection('userProfiles').doc(uid);
    await profileRef.create({
      email: user.email,
      ...user.profile,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    createdProfiles.push({ uid, existingAuthUser: action.type === 'repair' });
  }

  // Reset only Auth users that existed but had no profile; already seeded
  // accounts are left alone on repeat runs.
  for (const action of actions.filter(({ type }) => type === 'repair')) {
    await auth.updateUser(action.authUser.uid, {
      password: seedPassword,
      displayName: action.user.displayName,
    });
    updatedExistingPasswords.push(action.authUser.uid);
  }

  const createdCount = actions.filter(({ type }) => type === 'create').length;
  const repairedCount = actions.filter(({ type }) => type === 'repair').length;
  const skippedCount = actions.filter(({ type }) => type === 'skip').length;
  console.log(`Seed complete in ${projectId}: created ${createdCount}, repaired ${repairedCount}, already seeded ${skippedCount}.`);
  console.log('Created and repaired demo accounts use FIREBASE_SEED_PASSWORD.');
} catch (error) {
  // Roll back data created by this invocation if any step fails.
  for (const { uid, existingAuthUser } of createdProfiles.reverse()) {
    if (existingAuthUser && updatedExistingPasswords.includes(uid)) continue;
    try {
      await db.collection('userProfiles').doc(uid).delete();
    } catch {
      console.error(`Could not roll back userProfiles/${uid}.`);
    }
  }
  for (const uid of createdAuthUsers.reverse()) {
    try {
      await auth.deleteUser(uid);
    } catch {
      // Preserve the original failure; report the account for manual cleanup.
      console.error(`Could not roll back Firebase Auth user ${uid}.`);
    }
  }
  if (updatedExistingPasswords.length) {
    console.error(`Password was already reset for existing Auth user(s): ${updatedExistingPasswords.join(', ')}.`);
  }
  throw error;
} finally {
  await app.delete();
}
