import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import dbConnect from '@/lib/mongodb';
import User from '@/lib/models/User';

const NITMINER_API = process.env.NITMINER_API_URL || 'https://www.nitminer.com';

/**
 * Validates JWT token and returns FRESH user data from MongoDB
 * Key difference: Returns database values for isPremium and trialCount, not token values
 */
export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { error: 'Token is required' },
        { status: 400 }
      );
    }

    // Step 1: Verify JWT signature with NitMiner/TrustInn secret
    let decoded: any = null;
    try {
      const nitminerSecret = process.env.NITMINER_JWT_SECRET || process.env.NEXTAUTH_SECRET || 'nitminer-secret-key-2026';
      decoded = jwt.verify(token, nitminerSecret);
      console.log('[validate-token] JWT verified with NitMiner secret for user:', decoded.id || decoded.email);
    } catch (jwtError) {
      console.warn('[validate-token] JWT verification with NitMiner secret failed, trying TrustInn secret:', (jwtError as Error).message);
      
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET || 'trustinn-secret-key-2026-nitminer');
        console.log('[validate-token] JWT verified with TrustInn secret for user:', decoded.id || decoded.email);
      } catch (trustinnJwtError) {
        console.error('[validate-token] JWT verification failed for all known secrets:', trustinnJwtError);
        return NextResponse.json(
          { isValid: false, error: 'Invalid token signature' },
          { status: 401 }
        );
      }
    }

    // Step 1.5: Enforce active-session check at NitMiner so invalidated device tokens stop immediately.
    try {
      const sessionValidateResponse = await fetch(`${NITMINER_API}/api/auth/session/validate-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ token, email: decoded?.email }),
        cache: 'no-store',
      });

      const sessionData = await sessionValidateResponse.json().catch(() => ({}));

      if (!sessionValidateResponse.ok || sessionData?.isValid !== true) {
        console.warn('[validate-token] NitMiner session validation failed:', {
          status: sessionValidateResponse.status,
          reason: sessionData?.reason,
        });
        return NextResponse.json(
          { isValid: false, error: 'Session invalidated. Please login again.' },
          { status: 401 }
        );
      }
    } catch (sessionValidationError) {
      console.error('[validate-token] NitMiner session validation request failed:', sessionValidationError);
      return NextResponse.json(
        { isValid: false, error: 'Unable to verify session right now. Please login again.' },
        { status: 503 }
      );
    }

    // Step 2: Connect to database
    await dbConnect();

    // Step 3: Fetch FRESH user data from MongoDB (this is critical!)
    // Handle both TrustInn token format (id) and NitMiner format (_id or email)
    let user;
    const userId = decoded.id || decoded._id || decoded.mongoId;
    const userEmail = decoded.email;
    
    if (userId) {
      user = await User.findById(userId);
      console.log('[validate-token] User lookup by ID:', userId, user ? 'found' : 'not found');
    } else if (userEmail) {
      user = await User.findOne({ email: userEmail.toLowerCase() });
      console.log('[validate-token] User lookup by email:', userEmail, user ? 'found' : 'not found');
    }
    
    if (!user) {
      console.error('[validate-token] User not found in database:', { userId, userEmail });
      return NextResponse.json(
        { isValid: false, error: 'User not found' },
        { status: 404 }
      );
    }

    console.log('[validate-token] Fresh user data fetched from DB:', {
      email: user.email,
      isPremium: user.isPremium,
      trialCount: user.trialCount
    });

    // Step 4: Return fresh user data from database
    // IMPORTANT: isPremium and trialCount come from DB, not from token
    // Handle different field name variations from database
    const trialCount = Number(user.trialCount ?? user.noOfTrails ?? 0);
    const isPremium = Boolean(user.isPremium ?? user.hasPremium ?? false);
    
    const response = NextResponse.json(
      {
        isValid: true,
        user: {
          id: user._id.toString(),
          mongoId: user._id.toString(),
          firstName: user.firstName,
          lastName: user.lastName,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          email: user.email,
          role: user.role || 'user',
          isPremium: isPremium,
          trialCount: trialCount,
          isEmailVerified: user.isEmailVerified || false,
          subscription: {
            plan: user.subscription?.plan || null,
            status: user.subscription?.status || null,
            startDate: user.subscription?.startDate || null,
            endDate: user.subscription?.endDate || null
          }
        },
        token: token,
        expiresAt: new Date(decoded.exp * 1000).toISOString(),
        issuedAt: new Date(decoded.iat * 1000).toISOString()
      },
      { status: 200 }
    );
    
    // Add cache-busting headers - CRITICAL to prevent stale data
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    
    return response;
  } catch (error) {
    console.error('[validate-token] Unexpected error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { isValid: false, error: `Validation failed: ${errorMsg}` },
      { status: 500 }
    );
  }
}
