'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@hyperdata/design-system';
import { useTranslation } from '@/i18n';
import { AdminPageHeader, AdminShell } from '../components';
import { createSsoClient, deleteSsoClient, listSsoClients, setSsoClientActive, type SsoClient } from '../api/workspaceApi';

export function AdminSsoView() {
  const { t } = useTranslation();
  const [clients, setClients] = useState<SsoClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [createdCredentials, setCreatedCredentials] = useState<{ clientId: string; clientSecret: string | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SsoClient | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState({ name: '', description: '', redirectUris: '', clientType: 'CONFIDENTIAL' as SsoClient['clientType'] });
  const [clientTypeOpen, setClientTypeOpen] = useState(false);
  const [clientTypeActiveIndex, setClientTypeActiveIndex] = useState(0);
  const clientTypeRef = useRef<HTMLDivElement>(null);
  const clientTypeOptions: { value: SsoClient['clientType']; label: string }[] = [
    { value: 'CONFIDENTIAL', label: 'Confidential (server-side)' },
    { value: 'PUBLIC', label: 'Public (PKCE)' },
  ];

  useEffect(() => {
    if (!clientTypeOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!clientTypeRef.current?.contains(event.target as Node)) setClientTypeOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [clientTypeOpen]);

  const handleClientTypeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (!clientTypeOpen) {
        const selectedIndex = Math.max(0, clientTypeOptions.findIndex((option) => option.value === form.clientType));
        setClientTypeActiveIndex(event.key === 'Home' ? 0 : event.key === 'End' ? clientTypeOptions.length - 1 : selectedIndex);
        setClientTypeOpen(true);
      } else if (event.key === 'Home' || event.key === 'End') {
        setClientTypeActiveIndex(event.key === 'Home' ? 0 : clientTypeOptions.length - 1);
      } else {
        setClientTypeActiveIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : clientTypeOptions.length - 1)) % clientTypeOptions.length);
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (clientTypeOpen) {
        setForm((current) => ({ ...current, clientType: clientTypeOptions[clientTypeActiveIndex].value }));
        setClientTypeOpen(false);
      } else {
        setClientTypeActiveIndex(Math.max(0, clientTypeOptions.findIndex((option) => option.value === form.clientType)));
        setClientTypeOpen(true);
      }
    } else if (event.key === 'Escape' && clientTypeOpen) {
      event.preventDefault();
      setClientTypeOpen(false);
    } else if (event.key === 'Tab') {
      setClientTypeOpen(false);
    }
  };

  const refreshClients = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listSsoClients();
      setClients(result.clients || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load SSO clients.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refreshClients(); }, []);

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog) return;
    if (pendingDelete && !dialog.open) dialog.showModal();
    if (!pendingDelete && dialog.open) dialog.close();
  }, [pendingDelete]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const result = await createSsoClient({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        redirectUris: form.redirectUris.split(/\r?\n/).map((uri) => uri.trim()).filter(Boolean),
        clientType: form.clientType,
        allowedScopes: ['email', 'profile', 'hyperdatalab_profile'],
      });
      setCreatedCredentials({ clientId: result.client.clientId, clientSecret: result.client.clientSecret });
      setNotice('Application registered. Copy the client secret now; it is shown only once.');
      setForm({ name: '', description: '', redirectUris: '', clientType: 'CONFIDENTIAL' });
      await refreshClients();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to register the SSO client.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (client: SsoClient) => {
    setBusy(true);
    setError(null);
    try {
      await setSsoClientActive(client.clientId, !client.isActive);
      await refreshClients();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update the SSO client.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (client: SsoClient) => {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await deleteSsoClient(client.clientId);
      setNotice(`Deleted ${client.name}. Its issued SSO tokens have been revoked.`);
      await refreshClients();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete the SSO client.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell active="sso" title={t('admin.ssoSettings')}>
      <AdminPageHeader
        title={t('admin.ssoSettings')}
        description={t('admin.ssoSettingsDesc')}
      />

      <section className="workspace-admin workspace-sso-admin" aria-labelledby="sso-clients-title">
        <header className="workspace-admin__header">
          <div className="workspace-admin__heading">
            <span className="workspace-admin__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.7"/><path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
            </span>
            <div className="workspace-admin__title-group">
              <div className="workspace-admin__title-row">
                <h2 id="sso-clients-title">Connected applications</h2>
                <span className="workspace-admin__accounts-count">{clients.length} registered</span>
              </div>
              <p>Register other apps to sign in with approved HyperDataLab Workspace profiles.</p>
            </div>
          </div>
          <div className="workspace-admin__header-actions">
            <Button variant="secondary" disabled={loading || busy} onClick={() => void refreshClients()}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </header>

        {error && <div className="workspace-admin__error" role="alert">{error}</div>}
        {notice && <div className="workspace-sso-admin__notice" role="status">{notice}</div>}
        {createdCredentials && <div className="workspace-sso-admin__credentials">
          <div><strong>Save these credentials now</strong><span>The client secret is not stored in readable form and cannot be shown again.</span></div>
          <label>Client ID<input readOnly value={createdCredentials.clientId} onFocus={(event) => event.currentTarget.select()} /></label>
          {createdCredentials.clientSecret && <label>Client secret<input readOnly value={createdCredentials.clientSecret} onFocus={(event) => event.currentTarget.select()} /></label>}
          <Button variant="secondary" onClick={() => setCreatedCredentials(null)}>Dismiss</Button>
        </div>}

        <form className="workspace-sso-admin__form" onSubmit={(event) => void handleCreate(event)}>
          <div className="workspace-admin__create-heading"><div><h3>Register an application</h3><p>Use exact callback URLs; HTTPS is required outside localhost. PKCE S256 is required for every app. For browser-only apps, choose Public; the callback origin is allowed automatically.</p></div></div>
          <div className="workspace-sso-admin__form-grid">
            <label><span>Application name</span><input required minLength={2} maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Research portal" /></label>
            <div className="workspace-sso-admin__client-type-field" ref={clientTypeRef}>
              <span id="workspace-sso-client-type-label">Client type</span>
              <button
                type="button"
                className="workspace-sso-admin__client-type-trigger"
                aria-labelledby="workspace-sso-client-type-label workspace-sso-client-type-value"
                aria-haspopup="listbox"
                aria-expanded={clientTypeOpen}
                aria-controls="workspace-sso-client-type-options"
                aria-activedescendant={clientTypeOpen ? `workspace-sso-client-type-option-${clientTypeActiveIndex}` : undefined}
                onClick={() => {
                  if (!clientTypeOpen) setClientTypeActiveIndex(Math.max(0, clientTypeOptions.findIndex((option) => option.value === form.clientType)));
                  setClientTypeOpen((open) => !open);
                }}
                onKeyDown={handleClientTypeKeyDown}
              >
                <span id="workspace-sso-client-type-value">{clientTypeOptions.find((option) => option.value === form.clientType)?.label}</span>
                <svg aria-hidden="true" viewBox="0 0 12 8"><path d="m1 1.5 5 5 5-5" /></svg>
              </button>
              {clientTypeOpen && <div id="workspace-sso-client-type-options" className="workspace-sso-admin__client-type-menu" role="listbox" aria-labelledby="workspace-sso-client-type-label">
                {clientTypeOptions.map((option, index) => (
                  <div
                    id={`workspace-sso-client-type-option-${index}`}
                    key={option.value}
                    className={`workspace-sso-admin__client-type-option${clientTypeActiveIndex === index ? ' is-active' : ''}${form.clientType === option.value ? ' is-selected' : ''}`}
                    role="option"
                    aria-selected={form.clientType === option.value}
                    onMouseEnter={() => setClientTypeActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setForm((current) => ({ ...current, clientType: option.value }));
                      setClientTypeOpen(false);
                    }}
                  >
                    <span>{option.label}</span>
                    {form.clientType === option.value && <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m3 8 3.2 3.2L13 4.5" /></svg>}
                  </div>
                ))}
              </div>}
            </div>
            <label className="workspace-sso-admin__wide"><span>Description</span><input maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Optional purpose" /></label>
            <label className="workspace-sso-admin__wide"><span>Callback URL(s), one per line</span><textarea required rows={3} value={form.redirectUris} onChange={(event) => setForm({ ...form, redirectUris: event.target.value })} placeholder={'https://app.example.org/auth/callback\nhttp://localhost:3000/auth/callback'} /></label>
            <div className="workspace-sso-admin__scope-note"><strong>Profile scopes</strong><span>email · profile · hyperdatalab_profile (role, student ID, major)</span></div>
            <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Registering…' : 'Register application'}</Button>
          </div>
        </form>

        <div className="workspace-sso-admin__list">
          {loading && clients.length === 0 ? <p className="workspace-admin__empty">Loading connected applications…</p>
            : clients.length === 0 ? <p className="workspace-admin__empty">No connected applications registered.</p>
              : clients.map((client) => <article className="workspace-sso-admin__client" key={client.clientId}>
                <div className="workspace-sso-admin__client-heading"><div><h3>{client.name}</h3><code>{client.clientId}</code></div><span className={`workspace-admin__user-status ${client.isActive ? 'is-active' : 'is-suspended'}`}><span />{client.isActive ? 'Active' : 'Disabled'}</span></div>
                {client.description && <p>{client.description}</p>}
                <div className="workspace-sso-admin__client-meta"><span>{client.clientType}</span><span>{client.allowedScopes.join(' · ')}</span></div>
                <div className="workspace-sso-admin__redirects"><strong>Callbacks</strong>{client.redirectUris.map((uri) => <code key={uri}>{uri}</code>)}</div>
                <div className="workspace-sso-admin__client-actions">
                  <Button variant="secondary" disabled={busy} onClick={() => void handleToggle(client)}>{client.isActive ? 'Disable app' : 'Enable app'}</Button>
                  <Button variant="danger" disabled={busy} onClick={() => setPendingDelete(client)}>Delete app</Button>
                </div>
              </article>)}
        </div>
        <div className="workspace-sso-admin__endpoints"><strong>Integration endpoints</strong><code>/oauth/authorize</code><code>/oauth/token</code><code>/oauth/userinfo</code><span>Authorization Code + PKCE S256. Request profile scopes as needed.</span></div>
      </section>
      <dialog
        ref={deleteDialogRef}
        className="workspace-sso-admin__delete-dialog"
        aria-labelledby="workspace-sso-delete-title"
        aria-describedby="workspace-sso-delete-description"
        onCancel={(event) => { event.preventDefault(); setPendingDelete(null); }}
      >
        {pendingDelete && <div className="workspace-sso-admin__delete-content">
          <span className="workspace-sso-admin__delete-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 8v5m0 3h.01M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3l-7.5-13.1a2 2 0 0 0-3.4 0Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <div className="workspace-sso-admin__delete-copy">
            <h2 id="workspace-sso-delete-title">Delete this application?</h2>
            <p id="workspace-sso-delete-description">Permanently delete <strong>{pendingDelete.name}</strong>? This will revoke its issued SSO tokens and cannot be undone.</p>
          </div>
          <div className="workspace-sso-admin__delete-actions">
            <Button variant="secondary" disabled={busy} onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={() => {
              const client = pendingDelete;
              setPendingDelete(null);
              void handleDelete(client);
            }}>{busy ? 'Deleting…' : 'Delete application'}</Button>
          </div>
        </div>}
      </dialog>
    </AdminShell>
  );
}
