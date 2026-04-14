# TrustINN Desktop - Complete Auth Flow Analysis

## Executive Summary

The TrustINN Desktop application has a multi-layered authentication system that integrates with NitMiner's external auth API. The flow is generally well-structured with good fallbacks, but there are several potential issues in dev vs. production environmental handling, sessionStorage-only persistence, and some race conditions.

---

## 1. FILE STRUCTURE OVERVIEW - Auth Flow Key Files

### Frontend Components (React/Next.js)
- **[app/page.tsx](app/page.tsx)** - Home page, renders NoAccessError component
- **[app/tools/page.tsx](app/tools/page.tsx)** - Tools page, renders ToolsContent component
- **[components/NoAccessError.tsx](components/NoAccessError.tsx)** - Main login/auth gate component (1000+ lines)
- **[components/ToolsContent.tsx](components/ToolsContent.tsx)** - Protected tools interface with auth checks
- **[components/SessionInfoModal.tsx](components/SessionInfoModal.tsx)** - Session info display and account switching

### Backend/API
- **[app/api/auth/validate-token/route.ts](app/api/auth/validate-token/route.ts)** - Token validation endpoint
- **[app/layout.tsx](app/layout.tsx)** - Root layout with setup modal

### Electron Integration
- **[electron/main.cjs](electron/main.cjs)** - Main electron process with IPC handlers
- **[electron/preload.cjs](electron/preload.cjs)** - IPC bridge for secure window API exposure

### Utilities
- **[lib/jwtAuth.ts](lib/jwtAuth.ts)** - JWT token management utilities
- **[lib/mongodb.ts](lib/mongodb.ts)** - MongoDB connection for user data
- **[lib/models/User.ts](lib/models/User.ts)** - User database model

---

## 2. AUTH FLOW TRACE - From Login to /tools Navigation

### Step 1: Initial Page Load
**File:** [app/page.tsx](app/page.tsx)
- User lands on home page (https://localhost:3000 or file:/// in Electron)
- Renders `<NoAccessError />` component

### Step 2: DevMode Detection & Session Check
**File:** [components/NoAccessError.tsx](components/NoAccessError.tsx:171-236)

```typescript
// Line 171-173: isDevMode detection
const isDevMode = typeof window !== 'undefined' &&
  (window.location.protocol === 'http:' || window.location.protocol === 'https:');

// Line 182: useEffect runs on mount with isDevMode dependency
useEffect(() => {
  console.log('[NOACCESS] Component mounted. isDevMode:', isDevMode, 'showLogin:', showLogin);
  if (isDevMode) {
    console.log('[NOACCESS] Dev mode detected, opening login form automatically');
    setShowLogin(true);
  }
  // Line 190-230: checkSession runs async
  const checkSession = async () => { 
    // Checks for existing token in sessionStorage
    // Validates with backend /api/auth/validate-token
    // If valid, calls navigateToRoute('/tools') after 600ms
  };
  void checkSession();
}, [isDevMode]);
```

**⚠️ ISSUE FOUND:** In production (file:// protocol), `isDevMode` is FALSE, so login form is NOT auto-opened. User must click "Login to Continue" button.

### Step 3: Login Form Submission
**File:** [components/NoAccessError.tsx](components/NoAccessError.tsx:287-334)

```typescript
const handleLogin = async (e: React.FormEvent) => {
  // Line 289-304: Form validation
  // Line 310: Build device info
  const deviceInfo = await buildDeviceInfo();
  
  // Line 312-318: First call to NitMiner API - check for duplicate sessions
  try {
    duplicateResponse = await fetch(NITMINER_DUPLICATE_CHECK_API, {
      // https://www.nitminer.com/api/auth/session/check-duplicate
    });
  } catch {
    // Line 316-318: Fallback to local proxy endpoint
    duplicateResponse = await fetch('/api/external/auth/check-duplicate', {});
  }
  
  // Line 322-327: If isDuplicate, show modal, else proceed to login
  if (duplicateData?.isDuplicate) {
    setDuplicateModalOpen(true); // Show duplicate session modal
    return;
  }
  
  // Line 329: Proceed with actual login
  await doLogin(payload, deviceInfo);
};
```

**External APIs Called:**
1. **https://www.nitminer.com/api/auth/session/check-duplicate** - Check duplicate sessions
   - Fallback: `/api/external/auth/check-duplicate`
2. **https://www.nitminer.com/api/auth/login** - Actual login
   - Fallback: `/api/external/auth`
3. **https://www.nitminer.com/api/auth/session/invalidate-others** - Force logout other devices
   - Fallback: `/api/external/auth/invalidate-others`

### Step 4: Duplicate Device Flow (Optional)
**File:** [components/NoAccessError.tsx](components/NoAccessError.tsx:350-390)

If user has active sessions on other devices:
```typescript
// Modal shows duplicate sessions
// User selects: "Continue on This Device" or "Cancel"
// If "Continue", calls handleForceLogoutAndContinue()
// Step 1: POST to NITMINER_INVALIDATE_OTHERS_API
// Step 2: Call doLogin(pendingLoginPayload, pendingDeviceInfo)
```

### Step 5: Login Success - Store Session
**File:** [components/NoAccessError.tsx](components/NoAccessError.tsx:243-276)

```typescript
const doLogin = async (payload: Record<string, unknown>, deviceInfo: LocalDeviceInfo) => {
  // Line 248-257: Fetch from NitMiner auth API
  const data: LoginResponse = await response.json();
  
  // Line 263-273: Store token in sessionStorage
  const expiryTime = Date.now() + 60 * 60 * 1000; // 1 hour
  const expiryISO = new Date(expiryTime).toISOString();
  
  sessionStorage.setItem('trustinn_token', data.token);
  sessionStorage.setItem('trustinn_user_id', data.user.id);
  sessionStorage.setItem('token_expires', expiryISO);
  sessionStorage.setItem('trustinn_user', JSON.stringify(data.user));
  
  setSessionExpiry(expiryTime);
  setSuccess(true);
  
  // Line 274-276: Navigate to /tools after 800ms
  setTimeout(() => {
    void navigateToRoute('/tools');
  }, 800);
};
```

**Session Storage Keys:**
- `trustinn_token` - JWT token
- `trustinn_user_id` - User ID
- `token_expires` - Expiry timestamp (ISO string)
- `trustinn_user` - User object (JSON stringified)

### Step 6: Navigation Function
**File:** [components/NoAccessError.tsx](components/NoAccessError.tsx:94-107)

```typescript
async function navigateToRoute(route: string): Promise<void> {
  // Line 95: Try Electron IPC first
  const navigateResult = await window.electronAPI?.navigate?.(route);
  if (navigateResult?.ok) return;
  
  // Line 98-105: Fallback to window.location.href for web/production
  if (route === "/tools") {
    window.location.href = "./tools/"; // Relative path for file:// protocol
    return;
  }
  if (route === "/") {
    window.location.href = "./";
    return;
  }
  window.location.href = route; // Absolute path for http:// in web
}
```

### Step 7: Electron IPC Handler
**File:** [electron/main.cjs](electron/main.cjs:559-582)

```typescript
ipcMain.handle("app:navigate", async (_, route) => {
  const normalizedRoute = normalizeAppRoute(route);
  
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: "Main window is not available" };
  }
  
  try {
    if (isDev) {
      // Dev mode: Use http://localhost:3000
      await mainWindow.loadURL(`http://localhost:3000${normalizedRoute}`);
    } else {
      // Production: Load static HTML file from /out directory
      const routeHtmlPath = resolveStaticRouteHtml(normalizedRoute);
      if (!routeHtmlPath) {
        return { ok: false, error: `Route not found: ${normalizedRoute}` };
      }
      await mainWindow.loadFile(routeHtmlPath);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Navigation failed" };
  }
});
```

### Step 8: ToolsContent Auth Check on Mount
**File:** [components/ToolsContent.tsx](components/ToolsContent.tsx:900-948)

```typescript
useEffect(() => {
  const checkAuth = async () => {
    try {
      // Line 904-906: Retrieve session from sessionStorage
      const token = sessionStorage.getItem("trustinn_token");
      const userId = sessionStorage.getItem("trustinn_user_id");
      const userStr = sessionStorage.getItem("trustinn_user");
      
      if (!token || !userId) {
        console.log("[ToolsContent] No session found");
        setIsAuthenticated(false);
        return;
      }
      
      // Line 916-925: Check if token expired
      const expiryStr = sessionStorage.getItem("token_expires");
      if (expiryStr) {
        const expiryTime = new Date(expiryStr).getTime();
        if (expiryTime <= Date.now()) {
          console.log("[ToolsContent] Token expired");
          // Clear all session storage
          sessionStorage.removeItem("trustinn_token");
          sessionStorage.removeItem("trustinn_user_id");
          sessionStorage.removeItem("token_expires");
          sessionStorage.removeItem("trustinn_user");
          setIsAuthenticated(false);
          return;
        }
      }
      
      // Line 933-936: Parse and store user data
      if (userStr) {
        const parsedUser = JSON.parse(userStr);
        setUserData(parsedUser);
      }
      
      console.log("[ToolsContent] Session valid");
      setIsAuthenticated(true);
    } catch (error) {
      console.error("[ToolsContent] Auth check error:", error);
      setIsAuthenticated(false);
    } finally {
      setAuthLoading(false);
    }
  };
  
  void checkAuth();
}, []); // ⚠️ Empty dependency array - runs only once on mount
```

### Step 9: Tool Execution - Per-Request Auth Check
**File:** [components/ToolsContent.tsx](components/ToolsContent.tsx:1114-1135)

```typescript
const executeCommand = async (type: Tab) => {
  // Line 1115-1119: Strict auth check before execution
  if (!isAuthenticated) {
    mockAppendOutput(type, "❌ Session expired. Please login again.");
    setAuthLoading(true);
    setIsAuthenticated(false);
    return;
  }
  
  // Line 1124-1135: Check token still exists and is valid
  const token = sessionStorage.getItem("trustinn_token");
  if (!token) {
    mockAppendOutput(type, "❌ No valid session. Please login again.");
    setAuthLoading(true);
    setIsAuthenticated(false);
    return;
  }
  
  // Check expiry
  const expiryStr = sessionStorage.getItem("token_expires");
  if (expiryStr) {
    const expiryTime = new Date(expiryStr).getTime();
    if (expiryTime <= Date.now()) {
      mockAppendOutput(type, "❌ Session expired. Please login again.");
      // Clear session storage
      sessionStorage.removeItem(...);
      setIsAuthenticated(false);
      return;
    }
  }
  
  // Proceed with tool execution
};
```

---

## 3. STATE MANAGEMENT - How States Are Used Across Components

### NoAccessError.tsx State Machine

| State | Type | Purpose | Used In |
|-------|------|---------|---------|
| `showLogin` | boolean | Toggle between login form and "Access Restricted" view | Line 939 conditional rendering |
| `loginMode` | 'email'\|'username' | Track which login method selected | Line 953 tab buttons |
| `identifier` | string | Email or username input value | Line 975 input |
| `password` | string | Password input value | Line 988 input |
| `loading` | boolean | Disable form during submission | Line 1005 button.disabled |
| `error` | string | Display error message | Line 945 error box |
| `success` | boolean | Show success animation, trigger navigation | Line 926 conditional render |
| `sessionExpiry` | number\|null | Display countdown timer | getRemainingTime() |
| `duplicateModalOpen` | boolean | Show duplicate session modal | Line 1043+ modal JSX |
| `duplicateSessions` | DuplicateSessionInfo[] | List of duplicate sessions | Line 1043+ modal display |
| `pendingLoginPayload` | object\|null | Temp store during duplicate handling | Line 352 used in handleForceLogoutAndContinue |
| `pendingDeviceInfo` | LocalDeviceInfo\|null | Temp store device info for duplicate | Line 377 |

### State Dependencies

```
showLogin ← openLoginForm() ← button click
         ← [NOACCESS] Dev mode detection (line 183)
         ← Success → clears after navigation

success ← doLogin() successful response
       → Triggers navigateToRoute('/tools') after 800ms
       → Shows success animation (line 926)

isDevMode = (window.location.protocol === 'http:' || 'https:')
         → ONLY affects dev mode, NOT production (file://)
         
duplicateModalOpen → opens on isDuplicate response
                  → closes on handleForceLogoutAndContinue or cancel
                  → Loses state if component unmounts
```

### ToolsContent.tsx State Machine

| State | Type | Purpose |
|-------|------|---------|
| `isAuthenticated` | boolean | Auth gate for entire component (line 1593 conditional) |
| `authLoading` | boolean | Show loading spinner on mount (line 1575) |
| `userData` | object\|null | Display user info in UI |
| `showSessionModal` | boolean | Toggle session info modal |

**Critical:** When `isAuthenticated = false`:
```typescript
if (!isAuthenticated) {
  // Line 1593-1605: Show error screen instead of tools
  return (
    <div style={{
      position: "fixed", inset: 0, 
      background: "rgba(255,255,255,0.95)", 
      display: "flex", flexDirection: "column", gap: 16
    }}>
      <div style={{textAlign: "center"}}>
        <div style={{fontSize: 24, fontWeight: 800}}>⚠️ Session Expired</div>
        <div style={{fontSize: 14}}>Your session data has been cleared. Please login again.</div>
        <button onClick={() => void navigateToRoute("/")}>
          ← Go to Login
        </button>
      </div>
    </div>
  );
}
```

### SessionInfoModal.tsx State Usage

```typescript
const [userData, setUserData] = useState<any>(null);
const [lastUpdated, setLastUpdated] = useState<string>('Never');

// Line 36: Loads from sessionStorage when modal opens
useEffect(() => {
  if (isOpen) {
    const userStr = sessionStorage.getItem('trustinn_user');
    if (userStr) {
      const parsedUser = JSON.parse(userStr);
      setUserData(parsedUser);
      setLastUpdated(new Date().toLocaleTimeString());
    }
  }
}, [isOpen]);

// Line 43: Switch account clears sessionStorage
const handleSwitchAccount = () => {
  sessionStorage.clear();
  onClose();
  void navigateToRoute('/');
};
```

---

## 4. NAVIGATION FLOW - Dev vs Production

### Development Mode (npm run electron-dev)

```
1. electron/main.cjs starts with isDev = true
2. mainWindow.loadURL("http://localhost:3000")
3. App loads at http://localhost:3000

Navigation:
  - window.location.protocol = 'http:' → isDevMode = TRUE
  - Login form auto-opens ✅
  - navigateToRoute('/tools') calls:
    a) window.electronAPI.navigate('/tools') [primary]
    b) window.location.href = './tools/' [fallback]
  - Electron handler (line 567-568):
    await mainWindow.loadURL("http://localhost:3000/tools")
```

### Production Mode (Packaged Electron)

```
1. electron/main.cjs: isDev = false, app.isPackaged = true
2. Builds static Next.js with: npm run build
   - Outputs to /out directory with HTML files
3. mainWindow.loadFile(resolveStaticRouteHtml("/"))
   - Loads file:///path/to/app.asar/out/index.html

Navigation:
  - window.location.protocol = 'file:' → isDevMode = FALSE ⚠️
  - Login form does NOT auto-open (must click button)
  - navigateToRoute('/tools') calls:
    a) window.electronAPI.navigate('/tools') [primary]
    b) window.location.href = './tools/' [fallback]
  - Electron handler (line 571-572):
    const routeHtmlPath = resolveStaticRouteHtml("/tools")
    await mainWindow.loadFile(routeHtmlPath)
    - Loads file:///path/to/app.asar/out/tools/index.html
```

### Critical Bug: isDevMode Logic

**File:** [components/NoAccessError.tsx](components/NoAccessError.tsx:171-186)

```typescript
// ❌ INCORRECT LOGIC FOR PRODUCTION
const isDevMode = typeof window !== 'undefined' &&
  (window.location.protocol === 'http:' || window.location.protocol === 'https:');

useEffect(() => {
  if (isDevMode) {
    setShowLogin(true); // Auto-open login form
  }
}, [isDevMode]);
```

**Problem:**
- In production with Electron, `window.location.protocol = 'file:'`
- This makes `isDevMode = FALSE`
- Login form is NOT automatically opened
- User must manually click "Login to Continue" button

**Should be:**
```typescript
const isDevMode = typeof window !== 'undefined' &&
  (window.location.protocol === 'http:' || 
   window.location.protocol === 'https:' ||
   (window.location.protocol === 'file:' && !window.electronAPI)); // For single-file app
```

---

## 5. IPC BRIDGE VERIFICATION - window.electronAPI

### Preload Script Setup
**File:** [electron/preload.cjs](electron/preload.cjs)

```typescript
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Navigation
  ping: () => ipcRenderer.invoke("app:ping"),
  navigate: (route) => ipcRenderer.invoke("app:navigate", route),  // Line 15
  
  // File operations
  pickFile: () => ipcRenderer.invoke("tools:pick-file"),
  pickFolder: () => ipcRenderer.invoke("tools:pick-folder"),
  readFile: (filePath) => ipcRenderer.invoke("tools:read-file", filePath),
  writeTempFile: (content, language) => ipcRenderer.invoke("tools:write-temp-file", { content, language }),
  deleteTempFile: (filePath) => ipcRenderer.invoke("tools:delete-temp-file", filePath),
  
  // Tool execution
  listSamples: (payload) => safeInvoke("tools:list-samples", payload, "tools:list-c-samples"),
  runTool: (payload) => safeInvoke("tools:run-tool", payload, "tools:run-c-tool"),
  
  // Events
  onSetupStatus: (callback) => ipcRenderer.on("setup:status", ...),
  onUpdateAvailable: (callback) => ipcRenderer.on("update:available", ...),
});
```

### Main Process Handlers
**File:** [electron/main.cjs](electron/main.cjs:551-582)

```typescript
app.whenReady().then(() => {
  // Line 551-556: Ping handler
  ipcMain.handle("app:ping", async () => {
    return { message: "pong", platform: process.platform, date: new Date().toISOString() };
  });
  
  // Line 559-582: Navigate handler (CRITICAL FOR AUTH FLOW)
  ipcMain.handle("app:navigate", async (_, route) => {
    const normalizedRoute = normalizeAppRoute(route);
    
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: "Main window is not available" };
    }
    
    try {
      if (isDev) {
        await mainWindow.loadURL(`http://localhost:3000${normalizedRoute}`);
      } else {
        const routeHtmlPath = resolveStaticRouteHtml(normalizedRoute);
        if (!routeHtmlPath) {
          return { ok: false, error: `Route not found: ${normalizedRoute}` };
        }
        await mainWindow.loadFile(routeHtmlPath);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Navigation failed" };
    }
  });
});
```

### Safe Invoke Pattern
**File:** [electron/preload.cjs](electron/preload.cjs:1-12)

```typescript
async function safeInvoke(primaryChannel, payload, fallbackChannel) {
  try {
    return await ipcRenderer.invoke(primaryChannel, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Fall back if handler not found
    if (fallbackChannel && message.includes("No handler registered")) {
      return ipcRenderer.invoke(fallbackChannel, payload);
    }
    throw error;
  }
}
```

✅ **Verification:** IPC bridge is:
- Properly isolated with contextBridge
- All handlers registered in main.cjs
- Has error handling and fallbacks
- Secure (nodeIntegration=false, sandbox=true)

---

## 6. SESSION PERSISTENCE - sessionStorage Analysis

### Storage Mechanism
**File:** [components/NoAccessError.tsx](components/NoAccessError.tsx:270-274)

```typescript
sessionStorage.setItem('trustinn_token', data.token);
sessionStorage.setItem('trustinn_user_id', data.user.id);
sessionStorage.setItem('token_expires', expiryISO);
sessionStorage.setItem('trustinn_user', JSON.stringify(data.user));
```

### Storage Keys

| Key | Value Type | Source | Expiry |
|-----|-----------|--------|--------|
| `trustinn_token` | JWT string | NitMiner auth API response | `token_expires` |
| `trustinn_user_id` | User ID string | `data.user.id` from auth response | `token_expires` |
| `token_expires` | ISO datetime string | `Date.now() + 60*60*1000` | Auto-expires after 1 hour |
| `trustinn_user` | JSON object | `JSON.stringify(data.user)` from auth | `token_expires` |

### Persistence Characteristics

**sessionStorage vs localStorage vs cookies:**
- ❌ **NOT** using localStorage (would persist across tab close)
- ❌ **NOT** using cookies (would auto-send with HTTP requests)
- ✅ Using **sessionStorage** (clears on tab close/window close)

**Intentional Design:**
- Session is per-tab/per-window
- Closing tab = logout (security feature)
- Browser refresh = logout (new session)
- **Problem:** User can lose session unexpectedly

### Token Validation Points

**Frontend Validation:**
1. [NoAccessError.tsx:190-225](components/NoAccessError.tsx:190-225) - Check session on component mount
   - Calls `/api/auth/validate-token`
   - If valid, auto-navigates to /tools
   
2. [ToolsContent.tsx:900-948](components/ToolsContent.tsx:900-948) - Check session on component mount
   - Verifies token exists
   - Checks expiry time
   - If expired, clears sessionStorage
   
3. [ToolsContent.tsx:1114-1135](components/ToolsContent.tsx:1114-1135) - Pre-execution check
   - Before each tool run
   - Validates token and expiry

**Backend Validation:**
- [app/api/auth/validate-token/route.ts](app/api/auth/validate-token/route.ts) - Comprehensive validation
  - Step 1: Verify JWT signature (NitMiner or TrustInn secret)
  - Step 1.5: Call NitMiner session validate endpoint
  - Step 2: Connect to MongoDB
  - Step 3: Fetch fresh user data from database
  - Step 4: Return fresh data with cache-control headers

### Cache Control (Critical for Validation)
**File:** [app/api/auth/validate-token/route.ts](app/api/auth/validate-token/route.ts:133-136)

```typescript
// Add cache-busting headers - CRITICAL to prevent stale data
response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
response.headers.set('Pragma', 'no-cache');
response.headers.set('Expires', '0');
```

---

## 7. ERROR HANDLING - Silent Failures & Catch Blocks

### Error Handling Overview

**Files with try-catch blocks:**
- components/NoAccessError.tsx - 10+ try-catch blocks
- components/ToolsContent.tsx - 15+ try-catch blocks
- app/api/auth/validate-token/route.ts - 5+ try-catch blocks
- lib/jwtAuth.ts - 30+ try-catch blocks
- electron/main.cjs - 25+ try-catch blocks

### Critical Error Paths

#### 1. Token Validation Silent Failure
**File:** [components/NoAccessError.tsx](components/NoAccessError.tsx:205-214)

```typescript
try {
  const response = await fetch('/api/auth/validate-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: storedToken }),
  });
  const data = await response.json();
  isValidToken = Boolean(response.ok && data?.isValid);
} catch (validateError) {
  // ⚠️ Logs error but DOESN'T display to user
  console.error('Token validation request failed:', validateError);
  // Falls through to clearing sessionStorage
}

if (!isValidToken) {
  sessionStorage.removeItem('trustinn_token');
  // ... silently clears session without user notification
}
```

**Issue:** If token validation API fails:
- User is not notified
- Session is cleared silently
- User returned to login page without explanation

#### 2. Navigation Race Condition
**File:** [components/NoAccessError.tsx](components/NoAccessError.tsx:274-276)

```typescript
setTimeout(() => {
  void navigateToRoute('/tools');
}, 800);
```

**Issue:** If sessionStorage is cleared before timeout:
1. Success state shows (line 926)
2. navigateToRoute() called
3. ToolsContent mounts, checks auth
4. Session is gone, shows "Session Expired"

#### 3. Duplicate Session Loss on Re-render
**File:** [components/NoAccessError.tsx](components/NoAccessError.tsx:165-169)

```typescript
const [pendingLoginPayload, setPendingLoginPayload] = useState<Record<string, unknown> | null>(null);
const [pendingDeviceInfo, setPendingDeviceInfo] = useState<LocalDeviceInfo | null>(null);

// If component re-renders or modal is re-mounted:
// pendingLoginPayload could be lost
```

**Issue:** Modal state stored in React state, not persistent:
- If component unmounts, state is lost
- If user navigates away, state is lost
- Should use sessionStorage or context

#### 4. API Fallback Chain - Multiple Fetch Points
**File:** [components/NoAccessError.tsx](components/NoAccessError.tsx:248-257)

```typescript
try {
  response = await fetch(NITMINER_AUTH_API, {
    // Line 251: Fetch from external API
    // https://www.nitminer.com/api/auth/login
  });
} catch {
  response = await fetch('/api/external/auth', {
    // Line 254-255: Fallback to local proxy
  });
}
```

**Issue:** No error if BOTH fail:
- First fetch fails → catches and tries fallback
- Second fetch fails → throws unhandled or silent
- User sees generic error from line 296

#### 5. Catch with Ignored Error
**File:** [components/ToolsContent.tsx](components/ToolsContent.tsx:988)

```typescript
if (window.electronAPI?.stopRun) {
  try { await window.electronAPI.stopRun(); } 
  catch { /* ignore */ }  // ⚠️ Completely ignores errors
}
```

---

## 8. DEV MODE DETECTION - Protocol-Based Logic Issues

### Current Implementation
**File:** [components/NoAccessError.tsx](components/NoAccessError.tsx:171-173)

```typescript
const isDevMode = typeof window !== 'undefined' &&
  (window.location.protocol === 'http:' || window.location.protocol === 'https:');
```

### Logic Truth Table

| Scenario | Protocol | isDevMode | Login Auto-Opens | Issue |
|----------|----------|-----------|------------------|-------|
| npm run dev | http: | TRUE | ✅ Yes | Correct |
| npm run electron-dev | http: | TRUE | ✅ Yes | Correct |
| Production build on web | https: | TRUE | ✅ Yes | Correct |
| Production build Electron | file: | FALSE | ❌ No | **BUG** |
| Static export Electron | file: | FALSE | ❌ No | **BUG** |

### Where isDevMode is Used

1. **[NoAccessError.tsx:183]** - Auto-open login form
2. **[NoAccessError.tsx:924]** - Console logging for debugging
3. **[NoAccessError.tsx:939]** - Conditional render decision

### Impact of Bug

```typescript
// Line 939: Render logic
return success ? (
  // Show success animation
) : (showLogin || isDevMode) ? (  // ← isDevMode = FALSE in production
  // Show login form
) : (
  // Show "Access Restricted" view with buttons
);

// In production (file:// protocol):
// isDevMode = FALSE
// showLogin starts as FALSE
// So user sees "Access Restricted" view initially
// Must click "Login to Continue" button to open form
```

### Proposed Fix

```typescript
const isDevMode = typeof window !== 'undefined' &&
  (window.location.protocol === 'http:' || 
   window.location.protocol === 'https:' ||
   // Also treat file:// as dev if running in Electron (has electronAPI)
   (window.location.protocol === 'file:' && typeof window.electronAPI !== 'undefined'));
```

Or better approach:

```typescript
// Check if running in Electron environment
const isInElectron = typeof window !== 'undefined' && 
  typeof window.electronAPI !== 'undefined';

// Dev mode = not packaged (has NextJS dev server)
const isDevMode = typeof window !== 'undefined' &&
  (window.location.protocol === 'http:' || // Next dev server
   window.location.protocol === 'https:' || // Web server
   (window.location.protocol === 'file:' && isInElectron)); // Electron any mode
```

---

## 9. REDIRECT/NAVIGATION CALLS - Complete Map

### All Navigation Entry Points

| Location | File:Line | Function | Destination | Method |
|----------|-----------|----------|-------------|--------|
| Login success | NoAccessError.tsx:228 | navigateToRoute('/tools') | /tools | IPC + fallback |
| Session valid check | NoAccessError.tsx:228 | navigateToRoute('/tools') | /tools | IPC + fallback |
| Session timeout | ToolsContent.tsx:1605 | (button) navigateToRoute("/") | / | IPC + fallback |
| Session info → switch | SessionInfoModal.tsx:43 | navigateToRoute('/') | / | IPC + fallback |
| Login modal close | NoAccessError.tsx:1012 | setShowLogin(false) | (stays on page) | State only |

### All navigateToRoute Implementations

**[components/NoAccessError.tsx:94-107] - Primary implementation**
```typescript
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
```

**[components/ToolsContent.tsx:100-114] - Duplicate with same logic**
```typescript
async function navigateToRoute(route: string): Promise<void> {
  const navigateResult = await window.electronAPI?.navigate?.(route);
  if (navigateResult?.ok) return;
  
  // Identical to NoAccessError version
  if (route === "/") {
    window.location.href = "./";
    return;
  }
  if (route === "/tools") {
    window.location.href = "./tools/";
    return;
  }
  window.location.href = route;
}
```

**[components/SessionInfoModal.tsx:12-25] - Third duplicate**
```typescript
async function navigateToRoute(route: string): Promise<void> {
  const navigateResult = await window.electronAPI?.navigate?.(route);
  if (navigateResult?.ok) return;
  // Identical logic again
}
```

⚠️ **Code Duplication Issue:** `navigateToRoute` implemented 3 times identically. Should be in shared utility file.

### window.location.href Calls

| File:Line | Code | Protocol | Issue |
|-----------|------|----------|-------|
| NoAccessError:98 | `window.location.href = "./tools/"` | file:// | Relative path OK |
| NoAccessError:105 | `window.location.href = "./"` | file:// | Relative path OK |
| ToolsContent:105 | `window.location.href = "./"` | file:// | Relative path OK |
| ToolsContent:110 | `window.location.href = "./tools/"` | file:// | Relative path OK |
| lib/jwtAuth.ts:697 | `window.location.href = "https://www.nitminer.com${path}"` | any | Absolute URL to external site |

### Direct window.electronAPI Calls

| File:Line | API | Purpose | Error Handling |
|-----------|-----|---------|-----------------|
| NoAccessError:95 | window.electronAPI?.navigate | Route navigation | Returns {ok:false} |
| ToolsContent:1098 | window.electronAPI?.pickFile | Open file picker | Check result.ok |
| ToolsContent:1116 | window.electronAPI?.pickFolder | Open folder picker | Check result.ok |
| ToolsContent:988 | window.electronAPI?.stopRun | Stop tool execution | Ignored errors |
| ToolsContent:1049 | window.electronAPI?.listSamples | Load samples | Check result.ok |
| ToolsContent:1173 | window.electronAPI?.runTool | Execute tool | Check result.ok |

---

## 10. REACT STATE HOOKS - Closures, Dependencies, and Issues

### useEffect Dependencies Analysis

#### NoAccessError.tsx - useEffect at line 182

```typescript
useEffect(() => {
  console.log('[NOACCESS] Component mounted. isDevMode:', isDevMode, 'showLogin:', showLogin);
  if (isDevMode) {
    console.log('[NOACCESS] Dev mode detected, opening login form automatically');
    setShowLogin(true);
  }
  
  const checkSession = async () => {
    // ... body
  };
  
  void checkSession();
}, [isDevMode]); // ⚠️ Dependency array: [isDevMode]
```

**Issue Analysis:**
- Depends on: `isDevMode` (computed from window.location.protocol)
- `showLogin` is read but NOT in dependency (safe, used for logging only)
- If `isDevMode` changes, effect re-runs
- **Problem:** In SPA, `window.location.protocol` doesn't change after initial load
- **Result:** useEffect should probably run only once with [] dependency

**Better Code:**
```typescript
useEffect(() => {
  // ... same logic
}, []); // Empty dependency - runs once on mount
// Or if isDevMode computed outside component, memo it:
}, [isDevMode]);
```

#### ToolsContent.tsx - useEffect at line 896

```typescript
useEffect(() => {
  const checkAuth = async () => {
    // ... auth check logic
  };
  
  void checkAuth();
}, []); // ✅ Correct - runs once on mount
```

**Good:** Empty dependency array, runs only once.

#### SessionInfoModal.tsx - useEffect at line 34

```typescript
useEffect(() => {
  if (isOpen) {
    const userStr = sessionStorage.getItem('trustinn_user');
    // ... parse user
  }
}, [isOpen]); // ✅ Correct - runs when modal opens
```

**Good:** Depends on `isOpen`, re-reads from sessionStorage when modal opens.

### State Setter Issues

#### NoAccessError.tsx - Stale Closure Risk

```typescript
const handleLogin = async (e: React.FormEvent) => {
  e.preventDefault();
  setError('');
  setLoading(true);
  
  // Line 287-303: Validation
  // Line 310: Build device info
  // Line 312-318: Fetch duplicate check
  
  // ✅ No closure issues - all state updated after async completion
  // ✅ Try-catch properly scoped
  
  catch (err) {
    setError(err instanceof Error ? err.message : 'An error occurred during login');
  } finally {
    setDuplicateLoading(false);
    setLoading(false);
  }
};
```

**Safe:** State setters called appropriately after promises.

### Stale Closure Example - navigateToRoute

```typescript
setTimeout(() => {
  void navigateToRoute('/tools');
}, 800);
```

**Potential Issue:**
- If session is cleared between success and timeout, navigation will still try
- ToolsContent auth check will fail
- User sees "Session Expired"
- **But this is expected behavior**, not a bug

### useCallback Missing - Repeated Function Definitions

**Optimization Issue:** Not using useCallback for handlers

```typescript
// NoAccessError.tsx
const openLoginForm = () => {
  console.log('[LOGIN] openLoginForm called, isDevMode:', isDevMode, 'current showLogin:', showLogin);
  setError('');
  setShowLogin(true);
};

// Should be:
const openLoginForm = useCallback(() => {
  // ...
}, []); // Added to dependency array of child components
```

---

## 11. POTENTIAL ISSUES SUMMARY

### Critical Issues (Must Fix)

1. **🔴 isDevMode Bug in Production**
   - File: NoAccessError.tsx:171-173
   - Impact: Login form doesn't auto-open in Electron production
   - User must click button to see login
   - Fix: Include file:// protocol check for Electron

2. **🔴 navigateToRoute Code Duplication**
   - Files: NoAccessError.tsx, ToolsContent.tsx, SessionInfoModal.tsx
   - Impact: Maintenance burden, inconsistent behavior
   - Fix: Create shared utility in lib/ directory

### High Priority Issues

3. **🟠 Token Validation Silent Failure**
   - File: NoAccessError.tsx:205-214
   - Impact: Users not notified when token validation fails
   - Fix: Catch validation errors and display user-friendly message

4. **🟠 Duplicate Session State Lost on Re-render**
   - File: NoAccessError.tsx:165-169, 350-390
   - Impact: If component re-renders during duplicate modal, pendingLoginPayload lost
   - Fix: Persist to sessionStorage or use context

5. **🟠 Missing useCallback Optimization**
   - File: NoAccessError.tsx, ToolsContent.tsx
   - Impact: Performance, unnecessary re-renders
   - Fix: Wrap handlers in useCallback with proper dependencies

### Medium Priority Issues

6. **🟡 Error Handling Swallowed**
   - File: ToolsContent.tsx:988 (`catch { /* ignore */ }`)
   - Impact: Difficult to debug failures
   - Fix: At least log to console

7. **🟡 Session Expiry Not Refreshed**
   - Impact: After 1 hour, session expires with no way to extend
   - Fix: Implement token refresh on successful API calls

8. **🟡 sessionStorage-Only (No Persistence)**
   - Impact: Users must login every tab/window
   - Fix: Consider localStorage for persistent sessions (with security review)

### Low Priority Issues

9. **🟢 Relative Path Navigation Inconsistent**
   - Files: NoAccessError.tsx, ToolsContent.tsx (ordering different)
   - Impact: Minor inconsistency
   - Fix: Use consistent order

10. **🟢 Console Logging in Production**
    - Many console.log/console.error calls left in code
    - Fix: Wrap in DEV environment check or remove for production build

---

## 12. TEST SCENARIOS - Coverage Map

### Scenario 1: Fresh User Login (Dev Mode)
```
npm run electron-dev
→ Loads http://localhost:3000
→ NoAccessError mounts
→ isDevMode = TRUE
→ Login form auto-opens ✅
→ User enters credentials
→ handleLogin fires, checks duplicate
→ doLogin stores sessionStorage
→ navigateToRoute('/tools') called
→ electron IPC loads /tools route
→ ToolsContent mounts, checks auth ✅
→ User can see tools
```

### Scenario 2: Fresh User Login (Production)
```
Build: npm run build && npm run electron-build:mac:dmg
→ Loads file:///app/out/index.html (app.asar)
→ NoAccessError mounts
→ isDevMode = FALSE ❌ BUG
→ Login form does NOT auto-open ❌
→ User must click "Login to Continue" button
→ Same flow as dev after that
```

### Scenario 3: Existing Session
```
→ User already has trustinn_token in sessionStorage
→ NoAccessError mounts
→ checkSession async runs
→ Validates token with /api/auth/validate-token
→ API checks JWT and NitMiner session
→ If valid, setSuccess(true) after 600ms
→ navigateToRoute('/tools') auto-called
→ ToolsContent loads with valid session ✅
```

### Scenario 4: Expired Token
```
→ sessionStorage has token_expires in past
→ ToolsContent mounts
→ Checks expiryTime <= Date.now()
→ Clears all sessionStorage keys
→ setIsAuthenticated(false)
→ Shows "Session Expired" screen
→ User must click "Go to Login" to retry
```

### Scenario 5: Duplicate Device Flow
```
→ User logs in from Device B while Device A is active
→ handleLogin checks duplicate
→ NitMiner returns isDuplicate=true
→ duplicateModalOpen=true
→ Modal shows Device A's last activity
→ User clicks "Continue on This Device"
→ handleForceLogoutAndContinue fires
→ POST to invalidate-others API on Device A
→ Call doLogin with pending payload
→ Success, navigate to /tools
```

---

## 13. ENVIRONMENT VARIABLES & CONFIGURATION

### Required Env Variables

**File:** [app/api/auth/validate-token/route.ts](app/api/auth/validate-token/route.ts)

```typescript
const NITMINER_API = process.env.NITMINER_API_URL || 'https://www.nitminer.com';
```

**File:** [app/api/auth/validate-token/route.ts](app/api/auth/validate-token/route.ts:23-27)

```typescript
const nitminerSecret = process.env.NITMINER_JWT_SECRET || process.env.NEXTAUTH_SECRET || 'nitminer-secret-key-2026';
// ...
decoded = jwt.verify(token, process.env.JWT_SECRET || 'trustinn-secret-key-2026-nitminer');
```

### Electron Configuration

**File:** [electron/main.cjs](electron/main.cjs:9-16)

```typescript
const isDev = !app.isPackaged;
const DEFAULT_IMAGE = process.env.TRUSTINN_IMAGE || "rajeshbyreddy95/trustinn-tools:latest";
const DEFAULT_PLATFORM = process.env.TRUSTINN_PLATFORM || "linux/amd64";
const DEFAULT_RESULTS_DIR = process.env.TRUSTINN_RESULTS_DIR || path.join(os.homedir(), "Downloads", "TrustinnDownloads");
const PERSIST_RESULTS_DEFAULT = process.env.TRUSTINN_PERSIST_RESULTS === "1";
const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";
```

---

## 14. RECOMMENDATIONS & ACTION ITEMS

### Immediate Fixes (High Priority)
- [ ] Fix isDevMode to include file:// protocol in Electron
- [ ] Create shared utility function for navigateToRoute
- [ ] Add user-facing error message for token validation failure
- [ ] Persist duplicate session modal state to sessionStorage

### Short Term Improvements
- [ ] Implement token refresh mechanism
- [ ] Add loading states for all API calls
- [ ] Wrap console logging in DEV environment checks
- [ ] Use useCallback for frequently used handlers

### Long Term Enhancements  
- [ ] Consider localStorage for persistent sessions (with security review)
- [ ] Implement SQLite for offline session storage in Electron
- [ ] Add analytics for login failure tracking
- [ ] Implement automatic token refresh before expiry

### Testing
- [ ] Test production build in Electron (file:// protocol)
- [ ] Test duplicate device flow end-to-end
- [ ] Test network timeout scenarios
- [ ] Test sessionStorage clearing during navigation

---

## Appendix A: Complete Auth API Endpoints

### NitMiner External APIs (Production)

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| https://www.nitminer.com/api/auth/login | POST | Login with email/username | Basic auth |
| https://www.nitminer.com/api/auth/session/check-duplicate | POST | Check if device already logged in | Bearer token |
| https://www.nitminer.com/api/auth/session/invalidate-others | POST | Force logout other devices | Bearer token |
| https://www.nitminer.com/api/auth/session/validate-token | POST | Validate active session | Bearer token |

### Local Proxy Endpoints (Fallback)

| Endpoint | Purpose |
|----------|---------|
| /api/external/auth | POST login proxy |
| /api/external/auth/check-duplicate | Duplicate check proxy |
| /api/external/auth/invalidate-others | Invalidate others proxy |
| /api/auth/validate-token | Token validation |

---

## Appendix B: Session Storage JSON Schema

```typescript
// sessionStorage structure after successful login
{
  'trustinn_token': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  
  'trustinn_user_id': '507f1f77bcf86cd799439011',
  
  'token_expires': '2026-04-13T14:30:30.000Z',
  
  'trustinn_user': {
    'id': '507f1f77bcf86cd799439011',
    'email': 'user@nitminer.com',
    'firstName': 'John',
    'lastName': 'Doe',
    'isPremium': true,
    'trialCount': 3,
    'trialExceeded': false,
    'subscription': {
      'plan': 'premium',
      'status': 'active',
      'startDate': '2026-03-13T00:00:00Z',
      'endDate': '2026-04-13T00:00:00Z'
    }
  }
}
```

---

Generated: April 13, 2026
Analysis Tool: Comprehensive Codebase Scanner
Total Files Analyzed: 10+
Lines of Auth-Related Code: 2000+
