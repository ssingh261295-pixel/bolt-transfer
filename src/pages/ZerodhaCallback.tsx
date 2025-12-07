import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export function ZerodhaCallback() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('Processing Zerodha connection...');
  const [isSuccess, setIsSuccess] = useState<boolean | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        console.log('ZerodhaCallback: Starting callback processing');
        console.log('Session available:', !!session);
        console.log('Auth loading:', loading);

        if (loading) {
          console.log('Waiting for auth to complete...');
          setStatus('Waiting for authentication...');
          return;
        }

        if (!session?.access_token) {
          console.error('No session available after auth loading completed');
          setStatus('Session expired. Please login again and reconnect your broker.');
          setIsSuccess(false);
          redirectToBrokers(4000);
          return;
        }

        const params = new URLSearchParams(window.location.search);
        const requestToken = params.get('request_token');
        const authStatus = params.get('status');
        const state = params.get('state');

        console.log('Callback params:', { requestToken: !!requestToken, authStatus, state });

        if (authStatus !== 'success' || !requestToken) {
          console.error('Invalid callback params:', { authStatus, hasRequestToken: !!requestToken });
          setStatus('Connection failed. Zerodha authorization was not successful.');
          setIsSuccess(false);
          redirectToBrokers(3000);
          return;
        }

        const brokerConnectionId = state || localStorage.getItem('zerodha_broker_id');

        if (!brokerConnectionId) {
          console.error('Missing broker connection ID');
          setStatus('Connection failed. Missing broker connection ID.');
          setIsSuccess(false);
          redirectToBrokers(3000);
          return;
        }

        console.log('Exchanging token for broker:', brokerConnectionId);
        setStatus('Exchanging authorization token...');

        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-auth/exchange-token`;

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            request_token: requestToken,
            broker_connection_id: brokerConnectionId,
          }),
        });

        console.log('Token exchange response status:', response.status);
        const data = await response.json();
        console.log('Token exchange response data:', data);

        if (data.success) {
          setStatus('Successfully connected to Zerodha!');
          setIsSuccess(true);
          localStorage.removeItem('zerodha_broker_id');
          redirectToBrokers(2000);
        } else {
          const errorMsg = data.error || 'Failed to complete connection';
          console.error('Connection failed with error:', errorMsg);
          console.error('Full response:', data);

          let userFriendlyError = errorMsg;
          if (errorMsg.includes('Invalid checksum') || errorMsg.includes('Invalid API credentials')) {
            userFriendlyError = 'Invalid API credentials. Please verify your API Key and API Secret are correct.';
          } else if (errorMsg.includes('Token is invalid') || errorMsg.includes('request_token')) {
            userFriendlyError = 'Authorization token expired or invalid. Please make sure your redirect URL in Kite Connect matches exactly: ' + window.location.origin + '/';
          } else if (errorMsg.includes('missing') || errorMsg.includes('Missing')) {
            userFriendlyError = errorMsg;
          }

          setStatus(userFriendlyError);
          setIsSuccess(false);
          localStorage.removeItem('zerodha_broker_id');
          redirectToBrokers(5000);
        }
      } catch (error: any) {
        console.error('Callback error:', error);
        setStatus(`An error occurred: ${error.message || 'Unknown error'}`);
        setIsSuccess(false);
        localStorage.removeItem('zerodha_broker_id');
        redirectToBrokers(3000);
      }
    };

    const redirectToBrokers = (delay: number) => {
      setTimeout(() => {
        navigate('/brokers', { replace: true });
      }, delay);
    };

    handleCallback();
  }, [session, loading, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-2xl w-full">
        <div className="text-center">
          {isSuccess === null && (
            <Loader2 className="w-16 h-16 text-blue-600 animate-spin mx-auto mb-4" />
          )}
          {isSuccess === true && (
            <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
          )}
          {isSuccess === false && (
            <XCircle className="w-16 h-16 text-red-600 mx-auto mb-4" />
          )}

          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {isSuccess === null && 'Connecting to Zerodha'}
            {isSuccess === true && 'Connection Successful'}
            {isSuccess === false && 'Connection Failed'}
          </h2>

          <p className="text-gray-600 mb-4">{status}</p>

          <div className="text-sm text-gray-500">
            Redirecting to brokers page...
          </div>
        </div>

        {isSuccess === false && (
          <div className="mt-6 pt-6 border-t border-gray-200 text-left">
            <h3 className="font-semibold text-gray-900 mb-3">Troubleshooting Steps:</h3>
            <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
              <li>
                <strong>Verify Redirect URL:</strong> In your Kite Connect app settings, the redirect URL must be exactly:
                <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 mt-1 font-mono text-xs break-all">
                  {window.location.origin}/
                </div>
              </li>
              <li>
                <strong>Check API Credentials:</strong> Make sure your API Key and API Secret from Kite Connect are entered correctly (no extra spaces).
              </li>
              <li>
                <strong>Token Expiry:</strong> If you took too long to authorize, the request token may have expired. Try reconnecting again.
              </li>
              <li>
                <strong>Console Logs:</strong> Open browser console (F12) to see detailed error messages.
              </li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
