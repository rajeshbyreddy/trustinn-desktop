'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Clock3,
  Eye,
  EyeOff,
  Globe,
  Loader,
  Lock,
  LogOut,
  ShieldCheck,
  Tag,
  X,
  Zap,
} from 'lucide-react';
import DomeGallery from './DemoGallery';

interface LoginResponse {
  success?: boolean;
  message?: string;
  token?: string;
  user?: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    isPremium: boolean;
    trialCount: number;
    trialExceeded?: boolean;
  };
  error?: string;
}

interface DuplicateSessionInfo {
  id?: string;
  deviceName?: string;
  browser?: string;
  os?: string;
  loginTime?: string;
  lastActivity?: string;
  ipAddress?: string;
}

interface LocalDeviceInfo {
  deviceId: string;
  deviceFingerprint: string;
  deviceName: string;
  browser: string;
  os: string;
}

const SHARED_DEVICE_ID_KEY = 'nitminer_device_id';

function readCookieValue(name: string): string {
  if (typeof document === 'undefined') return '';
  const cookieName = `${name}=`;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(cookieName)) {
      return decodeURIComponent(trimmed.substring(cookieName.length));
    }
  }
  return '';
}

function writeSharedDeviceCookie(deviceId: string): void {
  if (typeof document === 'undefined') return;
  const encoded = encodeURIComponent(deviceId);
  const maxAge = 60 * 60 * 24 * 365 * 2;
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${SHARED_DEVICE_ID_KEY}=${encoded}; Domain=.nitminer.com; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  document.cookie = `${SHARED_DEVICE_ID_KEY}=${encoded}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

function getOrCreateSharedDeviceId(fingerprint: string): string {
  if (typeof window === 'undefined') return 'server-device';

  const cookieDeviceId = readCookieValue(SHARED_DEVICE_ID_KEY);
  const storageDeviceId = localStorage.getItem(SHARED_DEVICE_ID_KEY) || '';
  let deviceId = cookieDeviceId || storageDeviceId;

  if (!deviceId) {
    deviceId = `nmdev_${fingerprint.slice(0, 24)}`;
  }

  localStorage.setItem(SHARED_DEVICE_ID_KEY, deviceId);
  writeSharedDeviceCookie(deviceId);
  return deviceId;
}

async function navigateToRoute(route: string): Promise<void> {
  const navigateResult = await window.electronAPI?.navigate?.(route);
  if (navigateResult?.ok) return;

  if (route === "/tools") {
    window.location.href = "./tools/";
    return;
  }

  if (route === "/") {
    window.location.href = "./";
    return;
  }

  window.location.href = route;
}

function parseUserAgent() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const browser = ua.includes('Firefox') ? 'Firefox'
    : ua.includes('Edg') ? 'Edge'
    : ua.includes('Chrome') ? 'Chrome'
    : ua.includes('Safari') ? 'Safari' : 'Unknown';
  const os = ua.includes('Windows') ? 'Windows'
    : ua.includes('Mac') ? 'macOS'
    : ua.includes('Android') ? 'Android'
    : ua.includes('iPhone') || ua.includes('iPad') ? 'iOS'
    : ua.includes('Linux') ? 'Linux' : 'Unknown';
  return { browser, os };
}

async function createDeviceFingerprint(): Promise<string> {
  try {
    const raw = JSON.stringify({
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      language: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen: typeof window !== 'undefined' ? `${window.screen.width}x${window.screen.height}` : 'unknown',
      colorDepth: typeof window !== 'undefined' ? window.screen.colorDepth : 'unknown',
    });
    const input = new TextEncoder().encode(raw);
    const hash = await crypto.subtle.digest('SHA-256', input);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
  }
}

async function buildDeviceInfo(): Promise<LocalDeviceInfo> {
  const { browser, os } = parseUserAgent();
  const deviceFingerprint = await createDeviceFingerprint();
  const deviceId = getOrCreateSharedDeviceId(deviceFingerprint);
  return { deviceId, deviceFingerprint, browser, os, deviceName: `${os} - ${browser}` };
}

export default function NoAccessError() {
  const NITMINER_AUTH_API = 'https://www.nitminer.com/api/auth/login';
  const NITMINER_DUPLICATE_CHECK_API = 'https://www.nitminer.com/api/auth/session/check-duplicate';
  const NITMINER_INVALIDATE_OTHERS_API = 'https://www.nitminer.com/api/auth/session/invalidate-others';

  const [showLogin, setShowLogin] = useState(false);
  const [loginMode, setLoginMode] = useState<'email' | 'username'>('email');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [sessionExpiry, setSessionExpiry] = useState<number | null>(null);

  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [duplicateSessions, setDuplicateSessions] = useState<DuplicateSessionInfo[]>([]);
  const [pendingLoginPayload, setPendingLoginPayload] = useState<Record<string, unknown> | null>(null);
  const [pendingDeviceInfo, setPendingDeviceInfo] = useState<LocalDeviceInfo | null>(null);
  const [duplicateLoading, setDuplicateLoading] = useState(false);

  useEffect(() => {
    try {
      const storedToken = sessionStorage.getItem('trustinn_token');
      const storedExpiry = sessionStorage.getItem('token_expires');
      if (!storedToken || !storedExpiry) return;
      const expiryTime = new Date(storedExpiry).getTime();
      if (expiryTime > Date.now()) {
        setSessionExpiry(expiryTime);
        setSuccess(true);
        setTimeout(() => {
          void navigateToRoute('/tools');
        }, 600);
      } else {
        sessionStorage.removeItem('trustinn_token');
        sessionStorage.removeItem('trustinn_user_id');
        sessionStorage.removeItem('token_expires');
        sessionStorage.removeItem('trustinn_user');
      }
    } catch (err) {
      console.error('Error checking session:', err);
    }
  }, []);

  const getRemainingTime = () => {
    if (!sessionExpiry) return '';
    const remaining = Math.max(0, sessionExpiry - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const doLogin = async (payload: Record<string, unknown>, deviceInfo: LocalDeviceInfo) => {
    let response: Response;
    try {
      response = await fetch(NITMINER_AUTH_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ ...payload, ...deviceInfo }),
      });
    } catch {
      response = await fetch('/api/external/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ ...payload, ...deviceInfo }),
      });
    }
    const data: LoginResponse = await response.json();
    if (response.status === 409 && (data as any)?.isDuplicate) {
      setDuplicateSessions(Array.isArray((data as any).existingSessions) ? (data as any).existingSessions : []);
      setPendingLoginPayload(payload);
      setPendingDeviceInfo(deviceInfo);
      setDuplicateModalOpen(true);
      return;
    }
    if (!response.ok || !data.token || !data.user) {
      throw new Error(data.error || data.message || 'Login failed. Please try again.');
    }
    const expiryTime = Date.now() + 60 * 60 * 1000;
    const expiryISO = new Date(expiryTime).toISOString();
    sessionStorage.setItem('trustinn_token', data.token);
    sessionStorage.setItem('trustinn_user_id', data.user.id);
    sessionStorage.setItem('token_expires', expiryISO);
    sessionStorage.setItem('trustinn_user', JSON.stringify(data.user));
    setSessionExpiry(expiryTime);
    setSuccess(true);
    setTimeout(() => {
      void navigateToRoute('/tools');
    }, 800);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!identifier || !password) {
        setError(`${loginMode === 'email' ? 'Email' : 'Username'} and password are required`);
        return;
      }
      if (loginMode === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())) {
        setError('Please enter a valid email address');
        return;
      }
      if (loginMode === 'username' && identifier.trim().length < 3) {
        setError('Username must be at least 3 characters');
        return;
      }

      const payload = {
        ...(loginMode === 'email' ? { email: identifier.toLowerCase().trim() } : { username: identifier.trim() }),
        password,
        rememberMe: true
      };

      const deviceInfo = await buildDeviceInfo();
      setDuplicateLoading(true);

      const duplicateBody = JSON.stringify({ ...payload, ...deviceInfo });
      let duplicateResponse: Response;
      try {
        duplicateResponse = await fetch(NITMINER_DUPLICATE_CHECK_API, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: duplicateBody,
        });
      } catch {
        duplicateResponse = await fetch('/api/external/auth/check-duplicate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: duplicateBody,
        });
      }

      if (!duplicateResponse.ok) {
        throw new Error('Unable to verify active session right now. Please try again in a moment.');
      }

      const duplicateData = await duplicateResponse.json();
      if (duplicateData?.isDuplicate) {
        setDuplicateSessions(Array.isArray(duplicateData.existingSessions) ? duplicateData.existingSessions : []);
        setPendingLoginPayload(payload);
        setPendingDeviceInfo(deviceInfo);
        setDuplicateModalOpen(true);
        return;
      }

      await doLogin(payload, deviceInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during login');
    } finally {
      setDuplicateLoading(false);
      setLoading(false);
    }
  };

  const handleForceLogoutAndContinue = async () => {
    if (!pendingLoginPayload || !pendingDeviceInfo) return;
    setDuplicateLoading(true);
    setLoading(true);
    setError('');

    try {
      let invalidateResponse: Response;
      try {
        invalidateResponse = await fetch(NITMINER_INVALIDATE_OTHERS_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            ...(pendingLoginPayload.email ? { email: pendingLoginPayload.email } : { username: pendingLoginPayload.username }),
            deviceId: pendingDeviceInfo.deviceId,
            deviceFingerprint: pendingDeviceInfo.deviceFingerprint,
          }),
        });
      } catch {
        invalidateResponse = await fetch('/api/external/auth/invalidate-others', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            ...(pendingLoginPayload.email ? { email: pendingLoginPayload.email } : { username: pendingLoginPayload.username }),
            deviceId: pendingDeviceInfo.deviceId,
            deviceFingerprint: pendingDeviceInfo.deviceFingerprint,
          }),
        });
      }

      if (!invalidateResponse.ok) {
        const data = await invalidateResponse.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to logout existing device.');
      }

      setDuplicateModalOpen(false);
      await doLogin(pendingLoginPayload, pendingDeviceInfo);
      setPendingLoginPayload(null);
      setPendingDeviceInfo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to continue login');
    } finally {
      setDuplicateLoading(false);
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap');

        * { box-sizing: border-box; }

        .ti-root {
          font-family: 'DM Sans', sans-serif;
          min-height: 100vh;
          height: 100vh;
          overflow: hidden;
          background: #f8f9fc;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }

        .ti-dome-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          opacity: 0.42;
        }

        /* Soft light background */
        .ti-bg {
          position: fixed;
          inset: 0;
          z-index: 1;
          overflow: hidden;
        }
        .ti-bg::before {
          content: '';
          position: absolute;
          width: 900px; height: 900px;
          background: radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%);
          top: -300px; left: -300px;
          animation: drift1 14s ease-in-out infinite alternate;
        }
        .ti-bg::after {
          content: '';
          position: absolute;
          width: 700px; height: 700px;
          background: radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 70%);
          bottom: -200px; right: -200px;
          animation: drift2 16s ease-in-out infinite alternate;
        }

        @keyframes drift1 { from { transform: translate(0,0); } to { transform: translate(80px, 60px); } }
        @keyframes drift2 { from { transform: translate(0,0); } to { transform: translate(-70px, -80px); } }

        .ti-grid {
          position: fixed;
          inset: 0;
          background-image: 
            linear-gradient(rgba(0,0,0,0.018) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,0.018) 1px, transparent 1px);
          background-size: 70px 70px;
          z-index: 2;
          pointer-events: none;
        }

        .ti-card {
          position: relative;
          z-index: 10;
          width: 440px;
          background: rgba(255,255,255,0.95);
          border: 1px solid rgba(0,0,0,0.08);
          border-radius: 28px;
          overflow: hidden;
          backdrop-filter: blur(40px);
          box-shadow: 0 10px 40px rgba(0,0,0,0.08),
                      0 2px 10px rgba(0,0,0,0.05),
                      inset 0 1px 0 rgba(255,255,255,0.9);
        }

        .ti-topbar {
          height: 4px;
          background: linear-gradient(90deg, #6366f1, #8b5cf6, #06b6d4);
          background-size: 200% 100%;
          animation: shimmer 5s linear infinite;
        }
        @keyframes shimmer { 0% { background-position: 0% 0%; } 100% { background-position: 200% 0%; } }

        .ti-inner {
          padding: 36px 40px 32px;
        }

        .ti-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 32px;
        }
        .ti-logo-wrap {
          width: 40px; height: 40px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 16px rgba(99,102,241,0.3);
        }
        .ti-logo-wrap img { width: 28px; height: 28px; object-fit: contain; }

        .ti-brand-text { display: flex; flex-direction: column; }
        .ti-brand-name {
          font-family: 'Syne', sans-serif;
          font-size: 19px;
          font-weight: 700;
          color: #1a1a2e;
          letter-spacing: -0.4px;
        }
        .ti-brand-sub {
          font-size: 11px;
          color: #64748b;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          font-weight: 500;
        }

        .ti-divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(0,0,0,0.08), transparent);
          margin: 0 -40px 28px;
        }

        /* Landing State */
        .ti-lock-icon {
          width: 72px; height: 72px;
          background: linear-gradient(135deg, #fee2e2, #fef3f2);
          border: 1px solid #fecaca;
          border-radius: 20px;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 20px;
        }

        .ti-heading {
          font-family: 'Syne', sans-serif;
          font-size: 27px;
          font-weight: 700;
          color: #1a1a2e;
          letter-spacing: -0.6px;
          line-height: 1.15;
          margin-bottom: 8px;
        }

        .ti-subheading {
          font-size: 15px;
          color: #64748b;
          line-height: 1.55;
          margin-bottom: 24px;
        }

        .ti-pills {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 28px;
        }
        .ti-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          border-radius: 100px;
          font-size: 12.5px;
          color: #475569;
          font-weight: 500;
        }
        .ti-pill svg { color: #6366f1; }

        /* Buttons */
        .ti-btn-primary {
          width: 100%;
          padding: 15px 24px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          border: none;
          border-radius: 14px;
          color: #fff;
          font-family: 'Syne', sans-serif;
          font-size: 15.5px;
          font-weight: 600;
          letter-spacing: 0.2px;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          transition: all 0.2s;
          box-shadow: 0 8px 25px rgba(99,102,241,0.35);
        }
        .ti-btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 14px 35px rgba(99,102,241,0.45);
        }
        .ti-btn-primary:disabled { opacity: 0.65; cursor: not-allowed; transform: none; }

        .ti-btn-ghost {
          padding: 11px 16px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          color: #64748b;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 6px;
          text-decoration: none;
          transition: all 0.2s;
        }
        .ti-btn-ghost:hover {
          background: #f1f5f9;
          color: #334155;
          border-color: #cbd5e1;
        }

        /* Login Form */
        .ti-tab-row {
          display: flex;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 4px;
          gap: 4px;
          margin-bottom: 24px;
        }
        .ti-tab {
          flex: 1;
          padding: 10px;
          border: none;
          border-radius: 9px;
          font-size: 13.5px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          background: transparent;
          color: #64748b;
        }
        .ti-tab.active {
          background: white;
          color: #1e2937;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }

        .ti-field-group {
          margin-bottom: 16px;
        }
        .ti-label {
          display: block;
          font-size: 11.5px;
          font-weight: 600;
          letter-spacing: 0.7px;
          text-transform: uppercase;
          color: #64748b;
          margin-bottom: 8px;
        }
        .ti-input-wrap { position: relative; }
        .ti-input {
          width: 100%;
          padding: 13px 16px;
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          color: #1e2937;
          font-size: 15px;
          outline: none;
          transition: all 0.2s;
        }
        .ti-input:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 4px rgba(99,102,241,0.12);
        }
        .ti-input.has-icon { padding-right: 46px; }

        .ti-pw-toggle {
          position: absolute;
          right: 14px; top: 50%;
          transform: translateY(-50%);
          background: none; border: none;
          color: #94a3b8;
          cursor: pointer;
          padding: 4px;
        }
        .ti-pw-toggle:hover { color: #475569; }

        .ti-error {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 12px 14px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 10px;
          color: #ef4444;
          font-size: 13.5px;
          margin-bottom: 16px;
        }

        .ti-back-btn {
          width: 100%;
          padding: 11px;
          background: none;
          border: none;
          color: #64748b;
          font-size: 13.5px;
          cursor: pointer;
          margin-top: 10px;
        }
        .ti-back-btn:hover { color: #334155; }

        /* Success State */
        .ti-success-icon {
          width: 72px; height: 72px;
          background: linear-gradient(135deg, #d1fae5, #ecfdf5);
          border: 1px solid #a7f3d0;
          border-radius: 20px;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 20px;
          animation: scaleIn 0.4s cubic-bezier(0.34,1.56,0.64,1);
        }
        @keyframes scaleIn { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }

        /* Footer */
        .ti-footer {
          padding: 14px 40px;
          border-top: 1px solid #f1f5f9;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .ti-footer-dot {
          width: 5px; height: 5px;
          border-radius: 50%;
          background: #6366f1;
        }
        .ti-footer-text {
          font-size: 11.5px;
          color: #94a3b8;
          letter-spacing: 0.3px;
        }

        /* Duplicate Modal */
        .ti-modal-overlay {
          position: fixed; inset: 0; z-index: 100;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(12px);
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }
        .ti-modal {
          width: 100%; max-width: 400px;
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 25px 60px rgba(0,0,0,0.15);
        }
        .ti-modal-head {
          padding: 24px 28px 20px;
          border-bottom: 1px solid #f1f5f9;
          display: flex; align-items: center; gap: 12px;
        }
        .ti-modal-warn-icon {
          width: 40px; height: 40px;
          background: #fffbeb;
          border: 1px solid #fde68c;
          border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
        }
        .ti-modal-title {
          font-family: 'Syne', sans-serif;
          font-size: 17.5px;
          font-weight: 700;
          color: #1a1a2e;
        }
        .ti-modal-body { padding: 20px 28px; }
        .ti-modal-desc {
          font-size: 14px;
          color: #64748b;
          margin-bottom: 16px;
          line-height: 1.55;
        }
        .ti-modal-device {
          background: #fffbeb;
          border: 1px solid #fde68c;
          border-radius: 12px;
          padding: 14px 16px;
          display: flex; gap: 10px; align-items: flex-start;
        }
        .ti-modal-device-name {
          font-size: 14.5px; font-weight: 600; color: #1a1a2e;
          margin-bottom: 3px;
        }
        .ti-modal-device-meta {
          font-size: 12.5px; color: #64748b;
        }

        .ti-modal-foot {
          padding: 16px 28px 24px;
          display: flex; gap: 10px;
        }
        .ti-modal-cancel {
          flex: 1; padding: 12px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          color: #64748b;
          font-size: 13.5px; font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .ti-modal-cancel:hover {
          background: #f1f5f9;
          color: #334155;
        }

        .ti-modal-force {
          flex: 1; padding: 12px;
          background: linear-gradient(135deg, #ef4444, #dc2626);
          border: none;
          border-radius: 12px;
          color: #fff;
          font-size: 13.5px; font-weight: 600;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 6px;
          transition: all 0.2s;
          box-shadow: 0 4px 16px rgba(239,68,68,0.3);
        }
        .ti-modal-force:hover {
          box-shadow: 0 8px 25px rgba(239,68,68,0.4);
          transform: translateY(-1px);
        }

        .spin { animation: spin 0.7s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .fade-in { animation: fadeIn 0.35s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div className="ti-root">
        <div className="ti-dome-bg" aria-hidden="true">
          <DomeGallery
            fit={0.8}
            minRadius={600}
            maxVerticalRotationDeg={0}
            segments={34}
            dragDampening={2}
            grayscale
          />
        </div>
        <div className="ti-bg" />
        <div className="ti-grid" />

        {/* Duplicate Session Modal */}
        {duplicateModalOpen && (
          <div className="ti-modal-overlay">
            <div className="ti-modal">
              <div className="ti-modal-head">
                <div className="ti-modal-warn-icon">
                  <AlertCircle size={20} color="#f59e0b" />
                </div>
                <div className="ti-modal-title">Session Conflict</div>
              </div>
              <div className="ti-modal-body">
                <p className="ti-modal-desc">
                  This account is already active on another device.<br />
                  Log it out to continue here.
                </p>
                <div className="ti-modal-device">
                  <Globe size={16} color="#f59e0b" style={{ marginTop: 2 }} />
                  <div>
                    {(duplicateSessions.length > 0 ? duplicateSessions : [{}]).slice(0, 1).map((item, idx) => (
                      <div key={idx}>
                        <div className="ti-modal-device-name">{item.deviceName || 'Unknown Device'}</div>
                        <div className="ti-modal-device-meta">{item.browser} · {item.os}</div>
                        {item.loginTime && (
                          <div className="ti-modal-device-meta" style={{ marginTop: 4 }}>
                            Since {new Date(item.loginTime).toLocaleString()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="ti-modal-foot">
                <button 
                  className="ti-modal-cancel" 
                  onClick={() => setDuplicateModalOpen(false)} 
                  disabled={duplicateLoading}
                >
                  Cancel
                </button>
                <button 
                  className="ti-modal-force" 
                  onClick={handleForceLogoutAndContinue} 
                  disabled={duplicateLoading}
                >
                  {duplicateLoading ? (
                    <Loader size={15} className="spin" />
                  ) : (
                    <><LogOut size={15} /> Logout & Continue</>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="ti-card">
          <div className="ti-topbar" />
          <div className="ti-inner">

            {/* Brand Header */}
            <div className="ti-brand">
              <div className="">
                <img src="https://www.nitminer.com/_next/image?url=%2Fimages%2FLogo%2Flogo.png&w=48&q=75" alt="NitMiner" />
              </div>
              <div className="ti-brand-text">
                <span className="ti-brand-name">TrustInn</span>
                <span className="ti-brand-sub">by NitMiner Technologies Pvt. Ltd.</span>
              </div>
            </div>

            <div className="ti-divider" />

            {/* States */}
            {success ? (
              <div className="fade-in" style={{ textAlign: 'center', padding: '8px 0' }}>
                <div className="ti-success-icon">
                  <ShieldCheck size={32} color="#10b981" />
                </div>
                <div className="ti-heading" style={{ textAlign: 'center' }}>You're in!</div>
                <p className="ti-subheading" style={{ textAlign: 'center', marginBottom: 20 }}>
                  Redirecting to your tools…
                </p>
                <Loader size={22} className="spin" style={{ color: '#64748b', margin: '0 auto', display: 'block' }} />
              </div>

            ) : showLogin ? (
              <div className="fade-in">
                <div className="ti-heading">Welcome back</div>
                <p className="ti-subheading">Sign in to access TrustInn tools</p>

                {error && (
                  <div className="ti-error">
                    <AlertCircle size={15} />
                    <span>{error}</span>
                  </div>
                )}

                <div className="ti-tab-row">
                  <button 
                    className={`ti-tab ${loginMode === 'email' ? 'active' : ''}`}
                    type="button"
                    onClick={() => { setLoginMode('email'); setIdentifier(''); setError(''); }}
                  >
                    Email
                  </button>
                  <button 
                    className={`ti-tab ${loginMode === 'username' ? 'active' : ''}`}
                    type="button"
                    onClick={() => { setLoginMode('username'); setIdentifier(''); setError(''); }}
                  >
                    Username
                  </button>
                </div>

                <form onSubmit={handleLogin}>
                  <div className="ti-field-group">
                    <label className="ti-label">
                      {loginMode === 'email' ? 'Email Address' : 'Username'}
                    </label>
                    <input
                      className="ti-input"
                      type={loginMode === 'email' ? 'email' : 'text'}
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder={loginMode === 'email' ? 'you@nitminer.com' : 'yourusername'}
                      disabled={loading}
                    />
                  </div>

                  <div className="ti-field-group">
                    <label className="ti-label">Password</label>
                    <div className="ti-input-wrap">
                      <input
                        className="ti-input has-icon"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        disabled={loading}
                      />
                      <button 
                        type="button" 
                        className="ti-pw-toggle" 
                        onClick={() => setShowPassword(!showPassword)} 
                        disabled={loading}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <button type="submit" className="ti-btn-primary" disabled={loading}>
                    {loading ? (
                      <><Loader size={16} className="spin" /> Signing In…</>
                    ) : (
                      <>Sign In <ArrowRight size={16} /></>
                    )}
                  </button>
                </form>

                <button 
                  className="ti-back-btn" 
                  onClick={() => { 
                    setShowLogin(false); 
                    setError(''); 
                    setIdentifier(''); 
                    setPassword(''); 
                  }}
                >
                  ← Back
                </button>
              </div>

            ) : (
              <div className="fade-in">
                <div className="ti-lock-icon">
                  <Lock size={30} color="#ef4444" />
                </div>
                <div className="ti-heading">Access Restricted</div>
                <p className="ti-subheading">
                  You need an active NitMiner account to use TrustInn tools.
                </p>

                <div className="ti-pills">
                  <div className="ti-pill"><ShieldCheck size={12} /> Single-device protection</div>
                  <div className="ti-pill"><Lock size={12} /> Secure sessions</div>
                  <div className="ti-pill"><Zap size={12} /> Instant access</div>
                </div>

                <button className="ti-btn-primary" onClick={() => setShowLogin(true)}>
                  Login to Continue <ArrowRight size={16} />
                </button>

                <div className="ti-links-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '16px' }}>
                  <a href="https://www.nitminer.com" target="_blank" rel="noopener noreferrer" className="ti-btn-ghost">
                    <Globe size={14} /> Visit NitMiner
                  </a>
                  <a href="https://www.nitminer.com/pricing" target="_blank" rel="noopener noreferrer" className="ti-btn-ghost">
                    <Tag size={14} /> View Pricing
                  </a>
                </div>
              </div>
            )}
          </div>

          <div className="ti-footer">
            <div className="ti-footer-dot" />
            <span className="ti-footer-text">Protected by NitMiner · Single Device Login</span>
          </div>
        </div>
      </div>
    </>
  );
}