import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function ZerodhaCallback() {
  const { session } = useAuth();
  const [status, setStatus] = useState('Processing Zerodha connection...');
  const [isSuccess, setIsSuccess] = useState<boolean | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const requestToken = params.get('request_token');
        const authStatus = params.get('status');
        const state = params.get('state');

        if (authStatus !== 'success' || !requestToken) {
          setStatus('Connection failed. Zerodha authorization was not successful.');
          setIsSuccess(false);
          redirectToBrokers(3000);
          return;
        }

        const brokerConnectionId = state || localStorage.getItem('zerodha_broker_id');

        if (!brokerConnectionId) {
          setStatus('Connection failed. Missing broker connection ID.');
          setIsSuccess(false);
          redirectToBrokers(3000);
          return;
        }

        setStatus('Exchanging authorization token...');

        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zerodha-auth/exchange-token`;

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            request_token: requestToken,
            broker_connection_id: brokerConnectionId,
          }),
        });

        const data = await response.json();

        if (data.success) {
          setStatus('Successfully connected to Zerodha!');
          setIsSuccess(true);
          localStorage.removeItem('zerodha_broker_id');
          redirectToBrokers(2000);
        } else {
          setStatus(data.error || 'Failed to complete connection');
          setIsSuccess(false);
          localStorage.removeItem('zerodha_broker_id');
          redirectToBrokers(3000);
        }
      } catch (error) {
        setStatus('An error occurred while connecting to Zerodha');
        setIsSuccess(false);
        localStorage.removeItem('zerodha_broker_id');
        redirectToBrokers(3000);
      }
    };

    const redirectToBrokers = (delay: number) => {
      setTimeout(() => {
        window.location.href = window.location.origin;
      }, delay);
    };

    handleCallback();
  }, [session]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
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
    </div>
  );
}
