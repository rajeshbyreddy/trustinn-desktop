/**
 * JWT Token Management Utilities
 * Handles token extraction, validation, and session management for TrustInn
 */

let API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  'https://trustinn.nitminer.com';
const DEV_MODE = process.env.NEXT_PUBLIC_DEV_MODE === 'true';

// Load API URL from Electron app config if available
async function initializeAPIUrl() {
  if (typeof window !== 'undefined' && (window as any).api && (window as any).api.invoke) {
    try {
      const config = await (window as any).api.invoke('get-app-config');
      if (config?.apiUrl) {
        API_BASE_URL = config.apiUrl;
        console.log('[jwtAuth] API URL loaded from Electron config:', API_BASE_URL);
      }
    } catch (error) {
      console.log('[jwtAuth] Electron config not available, using default API URL:', API_BASE_URL);
    }
  }
}

// Initialize on module load
if (typeof window !== 'undefined') {
  initializeAPIUrl();
}

// Export function to update API URL dynamically
export function setAPIBaseUrl(url: string) {
  API_BASE_URL = url;
}

export function getAPIBaseUrl() {
  return API_BASE_URL;
}

// Log initialization status
if (typeof window !== 'undefined') {
  console.log('[jwtAuth] Initialization:', {
    API_BASE_URL,
    DEV_MODE,
    devModeMessage: DEV_MODE ? 'Backend validation DISABLED (DEV_MODE)' : 'Backend validation ENABLED'
  });
}

export interface NitMinerUser {
  id: string;
  mongoId?: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email: string;
  role: string;
  isPremium: boolean;
  trialCount: number;
  isEmailVerified?: boolean;
  subscription?: {
    plan: string | null;
    status: string | null;
    startDate: string | null;
    endDate: string | null;
  };
}

export interface SessionData {
  user: NitMinerUser;
  token: string;
  expiresAt: string;
  issuedAt: string;
  requiresEmailVerification?: boolean;
}

export interface SessionStatus {
  isValid: boolean;
  hasAccess: boolean;
  accessReason: 'premium' | 'trial' | 'no_access';
  trialCount: number;
  user?: NitMinerUser;
}

/**
 * Extracts JWT token from URL query parameters
 * @returns token or null if not found or invalid
 */
export function extractTokenFromURL(): string | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const urlParams = new URLSearchParams(window.location.search);
    let token = urlParams.get('token');
    
    if (!token) {
      console.log('[extractTokenFromURL] No token in URL');
      return null;
    }
    
    // Decode URI component if it was URL-encoded
    token = decodeURIComponent(token);
    
    // Validate token is a non-empty string
    if (typeof token !== 'string' || token.trim().length === 0) {
      console.warn('[extractTokenFromURL] Token is empty or not a string');
      return null;
    }
    
    // Validate JWT structure (3 parts separated by dots)
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.warn('[extractTokenFromURL] Token does not have valid JWT format:', {
        parts: parts.length,
        expected: 3,
        tokenLength: token.length
      });
      return null;
    }
    
    console.log('[extractTokenFromURL] Token extracted from URL successfully');
    return token;
  } catch (error) {
    console.error('[extractTokenFromURL] Error extracting token:', error);
    return null;
  }
}

/**
 * Stores minimal session data in sessionStorage (only token and user ID)
 * User data is always fetched from database
 */
export function storeSession(sessionData: SessionData): void {
  // Validate token format before storing
  let tokenToStore = sessionData.token;
  
  // If token is a JSON string, extract the actual token value
  if (typeof tokenToStore === 'string' && (tokenToStore.startsWith('"') || tokenToStore.startsWith("'"))) {
    try {
      tokenToStore = JSON.parse(tokenToStore);
      console.log('[storeSession] Token was JSON-stringified, extracted actual token');
    } catch (e) {
      // Token is not JSON, use as is
      console.log('[storeSession] Token is not JSON stringified, using as is');
    }
  }
  
  // Ensure token is a string and trim whitespace
  tokenToStore = String(tokenToStore).trim();
  
  // Validate token structure (should be JWT with 3 parts)
  const tokenParts = tokenToStore.split('.');
  if (tokenParts.length !== 3) {
    console.warn('[storeSession] Invalid token format - expected JWT with 3 parts, got', tokenParts.length);
  }
  
  console.log('[storeSession] Storing session:', {
    userId: sessionData.user.id,
    userEmail: sessionData.user.email,
    tokenLength: tokenToStore.length,
    tokenParts: tokenParts.length,
    expiresAt: sessionData.expiresAt
  });
  
  sessionStorage.setItem('trustinn_token', tokenToStore);
  sessionStorage.setItem('trustinn_user_id', sessionData.user.id);
  sessionStorage.setItem('token_expires', sessionData.expiresAt);
}

/**
 * Retrieves stored session token and user ID
 * User data is NOT stored locally - must be fetched from DB
 */
export function getStoredSessionToken(): { token: string; userId: string; expiresAt: string } | null {
  if (typeof window === 'undefined') return null;
  
  const token = sessionStorage.getItem('trustinn_token');
  const userId = sessionStorage.getItem('trustinn_user_id');
  const expiresAt = sessionStorage.getItem('token_expires');

  if (!token || !userId || !expiresAt) {
    console.warn('[getStoredSessionToken] Missing session data:', {
      hasToken: !!token,
      hasUserId: !!userId,
      hasExpiresAt: !!expiresAt
    });
    return null;
  }

  // Validate token format - should be a non-empty string
  let tokenStr = String(token).trim();
  
  if (tokenStr.length === 0) {
    console.error('[getStoredSessionToken] Token is empty string');
    return null;
  }
  
  // Handle case where token might be JSON stringified (has quotes) or is an object
  if (tokenStr.startsWith('"') || tokenStr.startsWith('{')) {
    try {
      const parsed = JSON.parse(tokenStr);
      if (typeof parsed === 'string') {
        tokenStr = parsed;
        console.log('[getStoredSessionToken] Token was JSON-stringified, extracted actual value');
      } else if (parsed && typeof parsed === 'object' && parsed.token) {
        tokenStr = parsed.token;
        console.log('[getStoredSessionToken] Token was in object, extracted from .token key');
      } else {
        console.error('[getStoredSessionToken] Token JSON parse result is not a string:', {
          type: typeof parsed,
          isObject: parsed && typeof parsed === 'object',
          hasTokenKey: parsed?.token ? true : false
        });
        return null;
      }
    } catch (parseError) {
      console.log('[getStoredSessionToken] Token is not JSON-parseable, using as-is');
    }
  }
  
  const tokenParts = tokenStr.split('.');
  
  if (tokenParts.length !== 3) {
    console.error('[getStoredSessionToken] Invalid token format:', {
      parts: tokenParts.length,
      tokenLength: tokenStr.length,
      expected: 3,
      tokenPreview: tokenStr.substring(0, 30) + (tokenStr.length > 30 ? '...' : '')
    });
    // Return null if token is malformed
    return null;
  }

  console.log('[getStoredSessionToken] Session retrieved successfully:', {
    userId,
    tokenLength: tokenStr.length,
    tokenParts: tokenParts.length
  });

  return { token: tokenStr, userId, expiresAt };
}

/**
 * Retrieves only the user ID from session
 */
export function getStoredUserId(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('trustinn_user_id');
}

/**
 * Clears all session data
 */
export function clearSession(): void {
  if (typeof window === 'undefined') return;
  
  sessionStorage.removeItem('trustinn_token');
  sessionStorage.removeItem('trustinn_user_id');
  sessionStorage.removeItem('token_expires');
}

/**
 * Fetches fresh user data from database
 * This is the preferred way to get user data - always from DB, never from cache
 */
export async function fetchUserFromDB(userId: string): Promise<NitMinerUser | null> {
  if (!userId) {
    console.warn('[fetchUserFromDB] No userId provided');
    return null;
  }

  try {
    console.log('[fetchUserFromDB] Fetching user from /api/auth/me:', { userId });
    const storedSession = getStoredSessionToken();

    if (!storedSession?.token) {
      console.warn('[fetchUserFromDB] Missing session token for /api/auth/me request');
      return null;
    }
    
    const response = await fetch('/api/auth/me', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${storedSession.token}`,
      },
      body: JSON.stringify({ userId }),
      credentials: 'include'
    });

    console.log('[fetchUserFromDB] Response status:', response.status);

    if (!response.ok) {
      // Try to read error response body for more details
      let errorBody: any = {};
      try {
        const text = await response.text();
        if (text) {
          try {
            errorBody = JSON.parse(text);
          } catch {
            errorBody = { error: text };
          }
        }
      } catch (e) {
        console.warn('[fetchUserFromDB] Could not read error response body');
      }

      console.error('[fetchUserFromDB] Failed to fetch user:', {
        status: response.status,
        statusText: response.statusText,
        userId,
        errorResponse: errorBody
      });
      return null;
    }

    const data = await response.json();
    console.log('[fetchUserFromDB] User fetched successfully:', data.user?.email);
    return data.user;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[fetchUserFromDB] Error fetching user data:', errorMsg);
    console.error('[fetchUserFromDB] Error details:', error);
    return null;
  }
}

/**
 * Fetches user trial count directly from database by email
 * This is used to get current trial status independent of session data
 */
export async function fetchTrialCountByEmail(email: string): Promise<{ trialCount: number; isPremium: boolean } | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/get-trial-count`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('[fetchTrialCountByEmail] Failed to fetch trial count:', response.statusText);
      return null;
    }

    const data = await response.json();
    return {
      trialCount: data.trialCount || 0,
      isPremium: data.isPremium || false
    };
  } catch (error) {
    console.error('[fetchTrialCountByEmail] Error:', error);
    return null;
  }
}

/**
 * Validates token with TrustInn backend
 * Backend will validate with NitMiner's API (server-to-server, no CORS issues)
 * 
 * In DEV_MODE, skips backend validation and returns a mock successful response
 * This allows testing without a running backend server
 * 
 * SECURITY: Validation happens on backend, not exposed to client
 */
export async function validateToken(token: string): Promise<{ isValid: boolean; data?: SessionData; error?: string }> {
  try {
    // DEV_MODE: Skip backend validation for testing without a running server
    if (DEV_MODE) {
      console.log('[validateToken] DEV_MODE enabled - decoding token without backend validation');
      
      // Decode the JWT token to get user data (without verification)
      try {
        const parts = token.split('.');
        if (parts.length !== 3) {
          throw new Error('Invalid token format');
        }
        
        const payload = JSON.parse(atob(parts[1]));
        
        const sessionData: SessionData = {
          user: {
            id: payload.id || 'unknown',
            mongoId: payload.mongoId,
            firstName: payload.firstName,
            lastName: payload.lastName,
            name: payload.name || `${payload.firstName || ''} ${payload.lastName || ''}`.trim() || 'Unknown User',
            email: payload.email || 'unknown@example.com',
            role: payload.role || 'user',
            isPremium: payload.isPremium || false,
            trialCount: payload.trialCount || 0,
            isEmailVerified: payload.isEmailVerified !== false,
            subscription: {
              plan: null,
              status: null,
              startDate: null,
              endDate: null
            }
          },
          token: token,
          expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          issuedAt: payload.iat ? new Date(payload.iat * 1000).toISOString() : new Date().toISOString()
        };
        
        console.log('[validateToken] Token decoded successfully:', {
          email: sessionData.user.email,
          name: sessionData.user.name,
          role: sessionData.user.role
        });
        
        return {
          isValid: true,
          data: sessionData
        };
      } catch (decodeError) {
        console.error('[validateToken] Failed to decode token:', decodeError);
        
        // Fallback to mock data if token decoding fails
        const mockSessionData: SessionData = {
          user: {
            id: 'dev-user-123',
            mongoId: 'dev_mongo_id',
            firstName: 'Dev',
            lastName: 'User',
            name: 'Dev User',
            email: 'dev@test.com',
            role: 'user',
            isPremium: false,
            trialCount: 5,
            isEmailVerified: true,
            subscription: {
              plan: null,
              status: null,
              startDate: null,
              endDate: null
            }
          },
          token: token,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          issuedAt: new Date().toISOString()
        };
        
        return {
          isValid: true,
          data: mockSessionData
        };
      }
    }

    const endpoint = `/api/auth/validate-token`;
    console.log('[validateToken] Starting token validation...');
    console.log('[validateToken] Proxy endpoint:', endpoint);
    console.log('[validateToken] Backend API_BASE_URL:', API_BASE_URL);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
        credentials: 'include',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      console.log('[validateToken] Response status:', response.status);

      if (!response.ok) {
        let errorBody: any = {};
        let responseBody = '';
        try {
          responseBody = await response.text();
          if (responseBody) {
            try {
              errorBody = JSON.parse(responseBody);
            } catch (e) {
              errorBody = { text: responseBody };
            }
          } else {
            errorBody = { emptyResponse: true };
          }
        } catch (e) {
          errorBody = { readError: 'Could not read response body' };
        }

        console.error('[validateToken] Backend validation error:', {
          endpoint,
          status: response.status,
          statusText: response.statusText,
          body: errorBody,
          rawBody: responseBody || '(empty)',
        });

        let errorMessage = `Validation failed: ${response.status} ${response.statusText}`;
        if (errorBody.error) {
          errorMessage = errorBody.error;
          if (errorBody.reason) errorMessage += ` - ${errorBody.reason}`;
          if (errorBody.details) errorMessage += ` (${errorBody.details})`;
        } else if (errorBody.message) {
          errorMessage = errorBody.message;
        } else if (errorBody.text) {
          errorMessage = errorBody.text;
        }

        return {
          isValid: false,
          error: errorMessage
        };
      }

      let data: any = null;
      try {
        data = await response.json();
      } catch (e) {
        console.warn('[validateToken] Backend returned non-JSON response');
        return {
          isValid: false,
          error: 'Invalid JSON returned from validation endpoint'
        };
      }

      console.log('[validateToken] Validation response received:', {
        isValid: data?.isValid,
        hasUser: !!data?.user,
        hasToken: !!data?.token
      });

      if (data?.isValid !== true) {
        return {
          isValid: false,
          error: data?.error || 'Token validation failed'
        };
      }

      if (!data?.user?.id || !data?.user?.email || !data?.token) {
        console.error('[validateToken] Missing required data in response');
        return {
          isValid: false,
          error: 'Invalid response from validation'
        };
      }

      console.log('[validateToken] Token validation succeeded');
      return {
        isValid: true,
        data: data
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError instanceof Error) {
        if (fetchError.name === 'AbortError') {
          console.error('[validateToken] Request timeout after 10 seconds');
          return {
            isValid: false,
            error: `Request timeout. Backend at ${API_BASE_URL} is not responding. Make sure the backend is running.`
          };
        }
        console.error('[validateToken] Fetch error:', fetchError.message);
        return {
          isValid: false,
          error: `Connection failed: ${fetchError.message}. Make sure ${API_BASE_URL} is running.`
        };
      }
      
      throw fetchError;
    }
  } catch (error) {
    console.error('[validateToken] Unexpected error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      isValid: false,
      error: `Validation failed: ${errorMsg}`
    };
  }
}

/**
 * Checks current session status
 * Returns whether user has access and remaining trials
 * Note: User data is fetched from DB separately using fetchUserFromDB
 */
export async function checkSessionStatus(userId: string): Promise<SessionStatus> {
  try {
    // Fetch fresh user data from DB
    const user = await fetchUserFromDB(userId);
    
    if (!user) {
      return {
        isValid: false,
        hasAccess: false,
        accessReason: 'no_access',
        trialCount: 0
      };
    }

    const hasAccess = user.isPremium || user.trialCount > 0;
    const accessReason = user.isPremium 
      ? 'premium' 
      : user.trialCount > 0 
        ? 'trial' 
        : 'no_access';

    return {
      isValid: true,
      hasAccess,
      accessReason,
      trialCount: user.trialCount,
      user
    };
  } catch (error) {
    console.error('Session check error:', error);
    return {
      isValid: false,
      hasAccess: false,
      accessReason: 'no_access',
      trialCount: 0
    };
  }
}

/**
 * Consumes one trial for the user
 * Should be called when user executes a tool
 * Returns updated trial count from database
 */
export async function consumeTrial(userId: string): Promise<{ consumed: boolean; remainingTrials: number; error?: string }> {
  try {
    console.log('[consumeTrial] Consuming trial for user:', userId);
    
    // Call LOCAL Next.js API endpoint, not external backend
    const response = await fetch('/api/auth/consume-trail', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId }),
      credentials: 'include'
    });

    console.log('[consumeTrial] Response status:', response.status);

    const data = await response.json();

    if (!response.ok) {
      console.error('[consumeTrial] Failed to consume trial:', data.message);
      return {
        consumed: false,
        remainingTrials: data.trialCount || 0,
        error: data.message
      };
    }

    console.log('[consumeTrial] Trial consumed successfully. New count:', data.trialCount);
    // Don't store user data locally - it will be fetched fresh from DB
    return {
      consumed: data.trialConsumed,
      remainingTrials: data.trialCount
    };
  } catch (error) {
    console.error('[consumeTrial] Error:', error);
    return {
      consumed: false,
      remainingTrials: 0,
      error: error instanceof Error ? error.message : 'Network error'
    };
  }
}

/**
 * Checks if user has access to premium features
 */
export function hasAccess(user: NitMinerUser): boolean {
  return user.isPremium || user.trialCount > 0;
}

/**
 * Checks if token and session have expired
 */
export async function isSessionExpired(expiresAt: string): Promise<boolean> {
  const now = new Date();
  const expiry = new Date(expiresAt);
  return now >= expiry;
}

/**
 * Redirects to NitMiner login/pricing page
 */
export function redirectToNitMiner(path: string = '/login'): void {
  if (typeof window !== 'undefined') {
    window.location.href = `https://www.nitminer.com${path}`;
  }
}

/**
 * Initializes JWT authentication
 * Extracts token from URL, validates it strictly, and stores minimal session info
 * Returns the user data or null if validation fails
 * 
 * SECURITY: This function is strict - any validation failure results in NO access
 */
export async function initializeAuth(): Promise<NitMinerUser | null> {
  try {
    // Step 1: Extract token from URL or sessionStorage
    let token = extractTokenFromURL();
    let tokenSource = 'URL';
    
    if (!token) {
      console.log('[initializeAuth] No token in URL, checking sessionStorage...');
      const storedSession = getStoredSessionToken();
      if (storedSession) {
        token = storedSession.token;
        tokenSource = 'sessionStorage';
        console.log('[initializeAuth] Token retrieved from sessionStorage');
      }
    } else {
      console.log('[initializeAuth] Token extracted from URL');
    }

    if (!token) {
      console.warn('[initializeAuth] No token found in URL or sessionStorage');
      return null;
    }

    // Step 2: Validate token with backend - STRICT validation
    // This also syncs trial count and other data from NitMiner
    console.log('[initializeAuth] Validating token with backend (source: ' + tokenSource + ')...');
    const validation = await validateToken(token);
    
    console.log('[initializeAuth] Token validation result:', {
      isValid: validation.isValid,
      tokenSource,
      error: validation.error
    });
    
    // Step 3: If validation failed, deny access completely
    if (!validation.isValid || !validation.data) {
      console.warn('[initializeAuth] Token validation failed:', validation.error);
      // Clear invalid session data
      clearSession();
      return null; // Access denied
    }

    console.log('[initializeAuth] Token validation successful');

    // Step 4: Store minimal session info (token + user ID only)
    storeSession(validation.data);
    console.log('[initializeAuth] Session stored');
    
    // Step 5: Return user data (includes synced trial count from NitMiner)
    console.log('[initializeAuth] Returning user data:', {
      email: validation.data.user.email,
      trialCount: validation.data.user.trialCount,
      isPremium: validation.data.user.isPremium
    });
    return validation.data.user;
  } catch (error) {
    console.error('[initializeAuth] Auth initialization error:', error);
    return null; // Access denied on error
  }
}
