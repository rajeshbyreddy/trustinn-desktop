'use client';

import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface SessionCheckModalProps {
  isOpen: boolean;
  user: any;
  onClose: () => void;
}

async function navigateToRoute(route: string): Promise<void> {
  const navigateResult = await window.electronAPI?.navigate?.(route);
  if (navigateResult?.ok) return;

  if (route === '/') {
    window.location.href = './';
    return;
  }

  if (route === '/tools') {
    window.location.href = './tools/';
    return;
  }

  window.location.href = route;
}

export function SessionCheckModal({ isOpen, user, onClose }: SessionCheckModalProps) {
  const [userData, setUserData] = useState<any>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('Never');

  // Load user data from sessionStorage when modal opens
  useEffect(() => {
    if (isOpen) {
      const userStr = sessionStorage.getItem('trustinn_user');
      if (userStr) {
        try {
          const parsedUser = JSON.parse(userStr);
          setUserData(parsedUser);
          setLastUpdated(new Date().toLocaleTimeString());
        } catch (e) {
          console.error('Failed to parse user data:', e);
        }
      }
    }
  }, [isOpen]);

  const handleSwitchAccount = () => {
    // Clear session storage
    sessionStorage.clear();
    onClose();
    // Redirect to login
    void navigateToRoute('/');
  };

  if (!isOpen) return null;

  const displayName = userData?.name || user?.name || 'User';
  const displayEmail = userData?.email || user?.email || 'Not available';
  const isPremium = userData?.isPremium || user?.isPremium || false;
  const trialCount = userData?.trialCount ?? user?.trialCount ?? 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Session Info</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* User Info Section */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Name
            </label>
            <p className="text-gray-900 font-medium">{displayName}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Email
            </label>
            <p className="text-gray-900 font-medium break-all">{displayEmail}</p>
          </div>

         

          <div className="border-t pt-4">
            <p className="text-xs text-gray-500">
              Last updated: {lastUpdated}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            onClick={handleSwitchAccount}
            className="w-full px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors"
          >
            Switch Account
          </button>

          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-gray-600 hover:text-gray-900 font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
