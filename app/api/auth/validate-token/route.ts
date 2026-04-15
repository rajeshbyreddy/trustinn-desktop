import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/lib/models/User';

// ✅ Not compatible with static export - only works in dev server mode
export const dynamic = 'error';

const NITMINER_API = process.env.NITMINER_API_URL || 'https://api.nitminer.com';

/**
 * Validates JWT token via NitMiner API, then fetches FRESH user data from LOCAL MongoDB
 * 
 * Flow:
 * 1. Call NitMiner to validate token signature (https://api.nitminer.com/api/auth/validate-token)
 * 2. Extract email from NitMiner response
 * 3. Query LOCAL MongoDB for fresh user data (real trial count, premium status)
 * 4. Return local database values + NitMiner validation result
 * 
 * This ensures we always get the latest trial count from the database, not from token payload
 */

async function validateTokenAndGetFreshData(token: string | null) {
  if (!token) {
    return NextResponse.json(
      { success: false, error: 'Token is required' },
      { status: 400 }
    );
  }

  try {
    // Step 1: Validate token with NitMiner API
    console.log('[validate-token] Validating token with NitMiner API...');
    const nitminerResponse = await fetch(`${NITMINER_API}/api/auth/validate-token`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!nitminerResponse.ok) {
      console.error('[validate-token] NitMiner validation failed:', nitminerResponse.status);
      return NextResponse.json(
        { success: false, error: 'Token validation failed' },
        { status: 401 }
      );
    }

    const nitminerData = await nitminerResponse.json();
    console.log('[validate-token] NitMiner response:', nitminerData);

    if (!nitminerData.success || !nitminerData.data) {
      console.error('[validate-token] Invalid NitMiner response structure:', nitminerData);
      return NextResponse.json(
        { success: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Step 2: Extract user email from NitMiner response
    const userEmail = nitminerData.data?.email;
    const nitminerUserId = nitminerData.data?.userId;

    if (!userEmail) {
      console.error('[validate-token] No email in NitMiner response');
      return NextResponse.json(
        { success: false, error: 'Invalid token data' },
        { status: 401 }
      );
    }

    // Step 3: Connect to LOCAL MongoDB and fetch FRESH user data
    console.log('[validate-token] Fetching fresh user data from local MongoDB for:', userEmail);
    await dbConnect();

    // Query by email (primary) or userId (fallback)
    let user;
    if (nitminerUserId) {
      user = await User.findById(nitminerUserId);
      if (!user) {
        console.log('[validate-token] User not found by ID, trying email...');
        user = await User.findOne({ email: userEmail.toLowerCase() });
      }
    } else {
      user = await User.findOne({ email: userEmail.toLowerCase() });
    }

    if (!user) {
      console.error('[validate-token] User not found in local database:', userEmail);
      return NextResponse.json(
        { success: false, error: 'User not found in local database' },
        { status: 404 }
      );
    }

    // Step 4: Extract fresh trial data from LOCAL database (not from token/NitMiner)
    const trialCount = Number(user.trialCount ?? user.noOfTrails ?? 0);
    const isPremium = Boolean(user.isPremium ?? user.hasPremium ?? false);

    console.log('[validate-token] Fresh user data from LOCAL DB:', {
      email: user.email,
      trialCount: trialCount,
      isPremium: isPremium,
      timestamp: new Date().toISOString()
    });

    // Step 5: Return FRESH user data from local database (NOT NitMiner values)
    const response = NextResponse.json(
      {
        success: true,
        message: 'Token is valid',
        data: {
          userId: user._id?.toString() || nitminerUserId,
          email: user.email,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || nitminerData.data?.name,
          isPremium: isPremium,  // ← FROM LOCAL DB, NOT NitMiner
          trialCount: trialCount,  // ← FROM LOCAL DB, NOT NitMiner
          role: user.role || 'user'
        },
        token: token,
      },
      { status: 200 }
    );

    // Add cache-busting headers - CRITICAL to prevent stale data
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    response.headers.set('X-Content-Type-Options', 'nosniff');

    return response;
  } catch (error) {
    console.error('[validate-token] Unexpected error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Validation failed: ${errorMsg}` },
      { status: 500 }
    );
  }
}

// GET handler: Extract token from Authorization header
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    console.log('[validate-token GET] Validating token from Authorization header');
    return validateTokenAndGetFreshData(token);
  } catch (error) {
    console.error('[validate-token GET] Unexpected error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Validation failed: ${errorMsg}` },
      { status: 500 }
    );
  }
}

// POST handler: Extract token from request body or Authorization header
export async function POST(request: NextRequest) {
  try {
    let token: string | null = null;

    // Try to get token from body first
    try {
      const body = await request.json();
      token = body.token;
    } catch {
      // If body parsing fails, try Authorization header
    }

    // Fallback to Authorization header
    if (!token) {
      const authHeader = request.headers.get('Authorization') || '';
      token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    }

    console.log('[validate-token POST] Validating token');
    return validateTokenAndGetFreshData(token);
  } catch (error) {
    console.error('[validate-token POST] Unexpected error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Validation failed: ${errorMsg}` },
      { status: 500 }
    );
  }
}
