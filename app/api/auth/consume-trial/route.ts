import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/lib/models/User';

// ✅ Not compatible with static export - only works in dev server mode
export const dynamic = 'error';

const NITMINER_API = process.env.NITMINER_API_URL || 'https://api.nitminer.com';

/**
 * Consumes one trial from user account
 * 
 * Flow:
 * 1. Validate token with NitMiner
 * 2. Query LOCAL MongoDB for user
 * 3. Deduct 1 trial from local database
 * 4. Return updated user data
 */

async function consumeTrialFromUser(token: string | null) {
  if (!token) {
    return NextResponse.json(
      { success: false, error: 'Token is required' },
      { status: 400 }
    );
  }

  try {
    // Step 1: Validate token with NitMiner API
    console.log('[consume-trial] Validating token with NitMiner API...');
    const nitminerResponse = await fetch(`${NITMINER_API}/api/auth/validate-token`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!nitminerResponse.ok) {
      console.error('[consume-trial] NitMiner validation failed:', nitminerResponse.status);
      return NextResponse.json(
        { success: false, error: 'Token validation failed' },
        { status: 401 }
      );
    }

    const nitminerData = await nitminerResponse.json();
    console.log('[consume-trial] NitMiner response:', nitminerData);

    if (!nitminerData.success || !nitminerData.data) {
      console.error('[consume-trial] Invalid NitMiner response structure:', nitminerData);
      return NextResponse.json(
        { success: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Step 2: Extract user email from NitMiner response
    const userEmail = nitminerData.data?.email;
    const nitminerUserId = nitminerData.data?.userId;

    if (!userEmail) {
      console.error('[consume-trial] No email in NitMiner response');
      return NextResponse.json(
        { success: false, error: 'Invalid token data' },
        { status: 401 }
      );
    }

    // Step 3: Connect to LOCAL MongoDB
    console.log('[consume-trial] Connecting to local MongoDB...');
    await dbConnect();

    // Step 4: Query by email (primary) or userId (fallback)
    let user;
    if (nitminerUserId) {
      user = await User.findById(nitminerUserId);
      if (!user) {
        console.log('[consume-trial] User not found by ID, trying email...');
        user = await User.findOne({ email: userEmail.toLowerCase() });
      }
    } else {
      user = await User.findOne({ email: userEmail.toLowerCase() });
    }

    if (!user) {
      console.error('[consume-trial] User not found in local database:', userEmail);
      return NextResponse.json(
        { success: false, error: 'User not found in local database' },
        { status: 404 }
      );
    }

    // Step 5: Get current trial count
    const currentTrialCount = Number(user.trialCount ?? user.noOfTrails ?? 0);
    const isPremium = Boolean(user.isPremium ?? user.hasPremium ?? false);

    console.log('[consume-trial] Current state before deduction:', {
      email: user.email,
      currentTrialCount: currentTrialCount,
      isPremium: isPremium
    });

    // Step 6: Premium users don't consume trials
    if (isPremium) {
      console.log('[consume-trial] User is premium - no trial deduction needed');
      return NextResponse.json(
        {
          success: true,
          message: 'Premium user - no trial consumed',
          data: {
            email: user.email,
            name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
            trialCount: currentTrialCount,
            isPremium: true,
            deducted: false
          }
        },
        { status: 200 }
      );
    }

    // Step 7: Non-premium users: deduct 1 trial (minimum 0)
    const newTrialCount = Math.max(0, currentTrialCount - 1);
    user.trialCount = newTrialCount;

    // Step 8: Save updated user to database
    await user.save();
    console.log('[consume-trial] Trial deducted successfully:', {
      email: user.email,
      oldTrialCount: currentTrialCount,
      newTrialCount: newTrialCount
    });

    // Step 9: Return updated user data
    const response = NextResponse.json(
      {
        success: true,
        message: 'Trial consumed successfully',
        data: {
          email: user.email,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          trialCount: newTrialCount,
          isPremium: false,
          deducted: true
        }
      },
      { status: 200 }
    );

    // Add cache-busting headers
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');

    return response;
  } catch (error) {
    console.error('[consume-trial] Unexpected error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Consumption failed: ${errorMsg}` },
      { status: 500 }
    );
  }
}

// POST handler: Extract token from Authorization header or request body
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

    console.log('[consume-trial POST] Consuming trial');
    return consumeTrialFromUser(token);
  } catch (error) {
    console.error('[consume-trial POST] Unexpected error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Consumption failed: ${errorMsg}` },
      { status: 500 }
    );
  }
}
