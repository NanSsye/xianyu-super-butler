import asyncio
import json
import os
from typing import Any, Dict, Optional

import aiohttp
from loguru import logger


VALID_SKUS = {
    'lite_month', 'lite_quarter', 'lite_year',
    'pro_month', 'pro_quarter', 'pro_year',
}
RETRY_DELAYS_SECONDS = (2, 10, 30)


def mask_code(code: str) -> str:
    if not code:
        return ''
    if len(code) <= 8:
        return '*' * len(code)
    return f'{code[:4]}***{code[-4:]}'


class WeibanRedemptionClient:
    """Server-only client for the Weiban redemption-code endpoint."""

    def __init__(self, db_manager, sleep_func=asyncio.sleep, session_factory=aiohttp.ClientSession):
        self.db_manager = db_manager
        self.sleep = sleep_func
        self.session_factory = session_factory

    def _config(self) -> Dict[str, Any]:
        return {
            'url': os.getenv('WEIBAN_REDEMPTION_API_URL', '').strip(),
            'key': os.getenv('WEIBAN_REDEMPTION_API_KEY', '').strip(),
            'connect_timeout': float(os.getenv('WEIBAN_REDEMPTION_CONNECT_TIMEOUT_SECONDS', '5')),
            'request_timeout': float(os.getenv('WEIBAN_REDEMPTION_REQUEST_TIMEOUT_SECONDS', '20')),
        }

    async def create_code(self, sku: str, order_id: str, note: str = '') -> Dict[str, Any]:
        sku = (sku or '').strip()
        order_id = str(order_id or '').strip()
        note = str(note or '').strip()

        if sku not in VALID_SKUS or not order_id or len(order_id) > 128 or len(note) > 255:
            self._audit(order_id, sku, None, 'validation_error', '', 'invalid local request', 0)
            return {'success': False, 'terminal': True, 'error_code': 'validation_error'}

        cached = self.db_manager.get_redemption_delivery(order_id)
        if cached:
            if cached.get('sku') != sku:
                self._audit(order_id, sku, 409, 'sku_conflict', '', 'local sku conflict', 0)
                return {'success': False, 'terminal': True, 'status': 409, 'error_code': 'sku_conflict'}
            code = cached.get('code') or ''
            if code:
                logger.info(f'微伴兑换码使用本地幂等记录: order_id={order_id}, sku={sku}, code={mask_code(code)}')
                return {'success': True, 'cached': True, 'status': cached.get('response_status', 200),
                        'order_id': order_id, 'sku': sku, 'code': code}

        config = self._config()
        if not config['url'] or not config['key']:
            self._audit(order_id, sku, 503, 'config_unavailable', '', 'server configuration missing', 0)
            logger.error('微伴兑换码接口未配置，自动发货已停止')
            return {'success': False, 'terminal': False, 'status': 503, 'error_code': 'config_unavailable'}

        payload = {'sku': sku, 'order_id': order_id}
        if note:
            payload['note'] = note
        headers = {'Content-Type': 'application/json', 'X-Redemption-Key': config['key']}
        timeout = aiohttp.ClientTimeout(total=config['request_timeout'], connect=config['connect_timeout'])

        for attempt in range(1, len(RETRY_DELAYS_SECONDS) + 2):
            try:
                async with self.session_factory(timeout=timeout) as session:
                    async with session.post(config['url'], headers=headers, json=payload) as response:
                        status = response.status
                        raw_body = await response.text()
                        body = self._parse_json(raw_body)

                if status == 200:
                    result = self._validate_success(body, order_id, sku)
                    if result:
                        code = result['code']
                        saved = self.db_manager.save_redemption_delivery(
                            order_id=order_id,
                            sku=sku,
                            code=code,
                            response_status=status,
                        )
                        if not saved:
                            self._audit(order_id, sku, status, 'persistence_error', mask_code(code),
                                        'failed to save delivery record', attempt)
                            return {'success': False, 'terminal': True, 'status': status,
                                    'error_code': 'persistence_error'}
                        self._audit(order_id, sku, status, 'success', mask_code(code), '', attempt)
                        logger.info(
                            f'微伴兑换码生成成功: order_id={order_id}, sku={sku}, code={mask_code(code)}'
                        )
                        return {'success': True, 'cached': False, 'status': status,
                                'order_id': order_id, 'sku': sku, 'code': code}

                    self._audit(order_id, sku, status, 'response_mismatch', '',
                                'response fields did not match request', attempt)
                    return {'success': False, 'terminal': True, 'status': status,
                            'error_code': 'response_mismatch'}

                error_code = self._status_error_code(status)
                self._audit(order_id, sku, status, error_code, '', self._safe_error(body), attempt)
                if status in (403, 409, 422):
                    logger.error(f'微伴兑换码请求停止: order_id={order_id}, sku={sku}, status={status}')
                    return {'success': False, 'terminal': True, 'status': status, 'error_code': error_code}
                if status >= 500 and attempt <= len(RETRY_DELAYS_SECONDS):
                    await self.sleep(RETRY_DELAYS_SECONDS[attempt - 1])
                    continue
                return {'success': False, 'terminal': status < 500, 'status': status,
                        'error_code': error_code}

            except (asyncio.TimeoutError, aiohttp.ClientError) as exc:
                self._audit(order_id, sku, None, 'network_error', '', type(exc).__name__, attempt)
                logger.warning(f'微伴兑换码网络异常: order_id={order_id}, sku={sku}, attempt={attempt}')
                if attempt <= len(RETRY_DELAYS_SECONDS):
                    await self.sleep(RETRY_DELAYS_SECONDS[attempt - 1])
                    continue
                return {'success': False, 'terminal': False, 'error_code': 'network_error'}

        return {'success': False, 'terminal': False, 'error_code': 'retry_exhausted'}

    def _audit(self, order_id: str, sku: str, status: Optional[int], outcome: str,
               masked_code: str, error_detail: str, attempt_no: int) -> None:
        try:
            self.db_manager.add_redemption_request_audit(
                order_id=order_id,
                sku=sku,
                response_status=status,
                outcome=outcome,
                masked_code=masked_code,
                error_detail=(error_detail or '')[:500],
                attempt_no=attempt_no,
            )
        except Exception as exc:
            logger.error(f'写入微伴兑换码审计失败: order_id={order_id}, type={type(exc).__name__}')

    @staticmethod
    def _parse_json(raw_body: str) -> Any:
        try:
            return json.loads(raw_body)
        except (json.JSONDecodeError, TypeError):
            return None

    @staticmethod
    def _validate_success(body: Any, order_id: str, sku: str) -> Optional[Dict[str, str]]:
        if not isinstance(body, dict):
            return None
        code = body.get('code')
        if body.get('order_id') != order_id or body.get('sku') != sku or not isinstance(code, str) or not code.strip():
            return None
        return {'code': code.strip()}

    @staticmethod
    def _status_error_code(status: int) -> str:
        return {
            403: 'auth_error',
            409: 'sku_conflict',
            422: 'validation_error',
            503: 'service_unavailable',
        }.get(status, 'server_error' if status >= 500 else 'unexpected_status')

    @staticmethod
    def _safe_error(body: Any) -> str:
        if not isinstance(body, dict):
            return 'non-json response'
        for key in ('detail', 'message', 'error'):
            value = body.get(key)
            if isinstance(value, str):
                return value[:500]
        return 'request failed'
