import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoDirectory = path.resolve(scriptDirectory, '..');
const projectConfig = JSON.parse(await readFile(path.join(repoDirectory, '.firebaserc'), 'utf8'));
const projectId = projectConfig.projects?.default;
const seed = JSON.parse(await readFile(path.join(scriptDirectory, 'seed-workspace-admin.json'), 'utf8'));
const confirmation = process.env.FIREBASE_SEED_CONFIRM_PROJECT;
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
  ? path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS.trim())
  : path.join(homedir(), '.firebase', `${projectId}-service-account.json`);
const email = String(seed.email || '').trim().toLowerCase();

if (!projectId) throw new Error('No default Firebase project is configured in .firebaserc.');
if (confirmation !== projectId) {
  throw new Error(`Refusing to seed. Set FIREBASE_SEED_CONFIRM_PROJECT=${projectId} in .env.local to confirm the target project.`);
}
if (seed.role !== 'ADMIN' || seed.status !== 'APPROVED' || seed.isActive !== true || !email.endsWith('@hyperdatalab.org')) {
  throw new Error('The Workspace admin seed must remain an active ADMIN profile for the configured Workspace domain.');
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(await readFile(credentialPath, 'utf8'));
} catch (error) {
  if (error.code === 'ENOENT') {
    throw new Error(`Firebase Admin credentials were not found at ${credentialPath}. Set GOOGLE_APPLICATION_CREDENTIALS in .env.local.`);
  }
  throw error;
}
if (serviceAccount.type !== 'service_account' || serviceAccount.project_id !== projectId) {
  throw new Error(`The service-account file must belong to Firebase project ${projectId}.`);
}

const app = initializeApp({ credential: cert(serviceAccount), projectId });
const auth = getAuth(app);
const db = getFirestore(app);

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runWrangler(args) {
  const resultOptions = {
    cwd: repoDirectory,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  };
  let result;
  if (process.platform === 'win32') {
    const tempDirectory = mkdtempSync(path.join(tmpdir(), 'researchpulse-wrangler-'));
    const batchFile = path.join(tempDirectory, 'run-wrangler.cmd');
    const quoteBatchArgument = (value) => {
      const argument = String(value).replaceAll('%', '%%').replaceAll('"', '""');
      return /[\s"&|<>^()%!]/.test(argument) ? `"${argument}"` : argument;
    };
    const command = ['wrangler@4.160.1', ...args].map(quoteBatchArgument).join(' ');
    try {
      writeFileSync(batchFile, `@echo off\r\nnpx --yes ${command}\r\nexit /b %ERRORLEVEL%\r\n`, 'utf8');
      result = spawnSync('cmd.exe', ['/d', '/c', batchFile], resultOptions);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  } else {
    result = spawnSync('npx', ['--yes', 'wrangler@4.160.1', ...args], resultOptions);
  }

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(output.trim());
  return output;
}

function parseWranglerResults(output) {
  const jsonStart = output.lastIndexOf('\n[');
  const jsonEnd = output.lastIndexOf('\n]');
  if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error(`Wrangler did not return D1 query results:\n${output.trim()}`);
  const batches = JSON.parse(output.slice(jsonStart + 1, jsonEnd + 2).trim());
  return batches.flatMap((batch) => batch.results || []);
}

async function getOrCreateAdminProfile() {
  const matches = await db.collection('userProfiles').where('email', '==', email).limit(2).get();
  if (matches.size > 1) throw new Error(`More than one Firebase profile uses ${email}. Resolve duplicates before seeding.`);

  let existingAuthUser;
  try {
    existingAuthUser = await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
  }
  if (existingAuthUser?.disabled) {
    throw new Error(`The Firebase Auth user for ${email} is disabled. Enable or review it before linking; no profile data was changed.`);
  }

  if (!matches.empty) {
    const document = matches.docs[0];
    const profile = document.data();
    if (profile.role !== 'ADMIN' || profile.status !== 'APPROVED' || profile.isActive !== true) {
      throw new Error(`Existing profile ${document.id} for ${email} is not an active approved ADMIN. No profile data was changed.`);
    }
    if (profile.workspaceEmail && String(profile.workspaceEmail).toLowerCase() !== email) {
      throw new Error(`Existing profile ${document.id} is already linked to another Workspace email. No profile data was changed.`);
    }

    await document.ref.set({
      workspaceEmail: email,
      loginProvider: 'google.com',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { uid: document.id, created: false };
  }

  const uid = existingAuthUser?.uid || randomUUID();
  const now = FieldValue.serverTimestamp();
  await db.collection('userProfiles').doc(uid).create({
    email,
    name: seed.displayName,
    firstName: seed.firstName,
    lastName: seed.lastName,
    role: 'ADMIN',
    status: 'APPROVED',
    isActive: true,
    workspaceEmail: email,
    loginProvider: 'google.com',
    createdAt: now,
    updatedAt: now,
  });
  return { uid, created: true };
}

async function writeWorkspaceLink(uid) {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'researchpulse-workspace-seed-'));
  const sqlFile = path.join(tempDirectory, 'seed-admin-link.sql');
  const now = new Date().toISOString();
  const safeUid = sqlString(uid);
  const safeEmail = sqlString(email);
  const safeNow = sqlString(now);

  const sql = `
INSERT OR IGNORE INTO workspace_identity_links
  (profile_uid, workspace_email, workspace_user_id, personal_email, status, onboarding_email_status, linked_by_uid, created_at, updated_at)
VALUES (${safeUid}, ${safeEmail}, ${safeEmail}, '', 'LINKED', 'PENDING', ${safeUid}, ${safeNow}, ${safeNow});

INSERT INTO workspace_audit_logs (actor_uid, action, occurred_at, outcome, target_id, detail)
SELECT ${safeUid}, 'WORKSPACE_PROFILE_LINKED', ${safeNow}, 'SUCCESS', ${safeEmail}, 'seeded-existing-workspace-admin'
WHERE EXISTS (
  SELECT 1 FROM workspace_identity_links
  WHERE profile_uid = ${safeUid} AND workspace_email = ${safeEmail} AND status = 'LINKED'
)
AND NOT EXISTS (
  SELECT 1 FROM workspace_audit_logs
  WHERE actor_uid = ${safeUid} AND action = 'WORKSPACE_PROFILE_LINKED'
    AND target_id = ${safeEmail} AND detail = 'seeded-existing-workspace-admin'
);

SELECT 'WORKSPACE_ADMIN_SEED_OK' AS seed_status
WHERE EXISTS (
  SELECT 1 FROM workspace_identity_links
  WHERE profile_uid = ${safeUid} AND workspace_email = ${safeEmail} AND status = 'LINKED'
);
`;

  try {
    await writeFile(sqlFile, sql, 'utf8');
    try {
      runWrangler([
        'd1', 'execute', 'researchpulse-workspace', '--remote', '--config', 'worker/wrangler.toml', '--file', sqlFile,
      ]);
    } catch (error) {
      throw new Error(`Cloudflare D1 seed failed. Confirm migration 0004 is applied and check Wrangler output:\n${error.message}`);
    }

    let resultRows;
    try {
      const verification = runWrangler([
        'd1', 'execute', 'researchpulse-workspace', '--remote', '--config', 'worker/wrangler.toml',
        '--command', `SELECT CASE WHEN EXISTS (SELECT 1 FROM workspace_identity_links WHERE profile_uid = ${safeUid} AND workspace_email = ${safeEmail} AND status = 'LINKED') THEN 'WORKSPACE_ADMIN_SEED_OK' ELSE 'WORKSPACE_ADMIN_SEED_CONFLICT' END AS seed_status`,
      ]);
      resultRows = parseWranglerResults(verification);
    } catch (error) {
      throw new Error(`Firebase profile and D1 seed ran, but D1 link verification failed:\n${error.message}`);
    }
    if (!resultRows.some((row) => row.seed_status === 'WORKSPACE_ADMIN_SEED_OK')) {
      throw new Error('Firebase profile was saved, but D1 has a conflicting or suspended Workspace link. Resolve that link before retrying.');
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

try {
  const profile = await getOrCreateAdminProfile();
  await writeWorkspaceLink(profile.uid);
  console.log(`Workspace admin profile linked in Firebase ${projectId} and Cloudflare D1.`);
  console.log(`Mailbox reused: ${email}; profile ${profile.created ? 'created' : 'reused'} (UID ${profile.uid}).`);
  console.log('No Workspace user was created, no password was changed, and no email was sent.');
} finally {
  await app.delete();
}
