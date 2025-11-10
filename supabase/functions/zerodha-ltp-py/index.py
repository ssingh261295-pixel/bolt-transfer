import json
import os
from supabase import create_client, Client
from kiteconnect import KiteConnect

def handler(req):
    # CORS headers
    cors_headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
    }

    # Handle OPTIONS request
    if req.method == 'OPTIONS':
        return Response(
            status=200,
            headers=cors_headers
        )

    try:
        # Initialize Supabase client
        supabase_url = os.environ.get('SUPABASE_URL')
        supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
        supabase: Client = create_client(supabase_url, supabase_key)

        # Get auth token from header
        auth_header = req.headers.get('Authorization', '')
        if not auth_header:
            raise Exception('No authorization header')

        token = auth_header.replace('Bearer ', '')
        user_response = supabase.auth.get_user(token)
        user = user_response.user

        if not user:
            raise Exception('Unauthorized')

        # Get parameters
        params = dict(req.url.params)
        broker_id = params.get('broker_id')
        instruments_str = params.get('instruments', '')

        if not broker_id:
            raise Exception('Missing broker_id parameter')

        if not instruments_str:
            raise Exception('Missing instruments parameter')

        # Get broker connection
        broker_response = supabase.table('broker_connections') \
            .select('api_key, access_token') \
            .eq('id', broker_id) \
            .eq('user_id', user.id) \
            .maybe_single() \
            .execute()

        if not broker_response.data or not broker_response.data.get('access_token'):
            raise Exception('Broker not connected or access token missing')

        broker_data = broker_response.data
        api_key = broker_data['api_key']
        access_token = broker_data['access_token']

        # Initialize KiteConnect
        kite = KiteConnect(api_key=api_key)
        kite.set_access_token(access_token)

        # Parse instruments (can be comma-separated or single)
        instruments_list = [i.strip() for i in instruments_str.split(',')]

        # Fetch LTP using KiteConnect's optimized method
        ltp_data = kite.ltp(instruments_list)

        return Response(
            json.dumps({
                'success': True,
                'data': ltp_data
            }),
            status=200,
            headers={
                **cors_headers,
                'Content-Type': 'application/json'
            }
        )

    except Exception as e:
        return Response(
            json.dumps({
                'success': False,
                'error': str(e)
            }),
            status=400,
            headers={
                **cors_headers,
                'Content-Type': 'application/json'
            }
        )

class Response:
    def __init__(self, body='', status=200, headers=None):
        self.body = body
        self.status = status
        self.headers = headers or {}
