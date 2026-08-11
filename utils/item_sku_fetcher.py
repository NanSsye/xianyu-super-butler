import asyncio
from typing import Any, Dict, List

from loguru import logger

from utils.order_detail_fetcher import OrderDetailFetcher


DETAIL_API_PATH = '/h5/mtop.taobao.idle.pc.detail/1.0/'


def normalize_item_skus(payload: Dict[str, Any], expected_item_id: str) -> List[Dict[str, Any]]:
    item_data = payload.get('data', {}).get('itemDO', {})
    response_item_id = str(item_data.get('itemId') or '')
    if response_item_id and response_item_id != str(expected_item_id):
        raise ValueError('闲鱼返回的商品ID与请求不一致')

    normalized = []
    for sku in item_data.get('skuList') or item_data.get('idleItemSkuList') or []:
        properties = []
        for prop in sku.get('propertyList') or []:
            if prop.get('enabled') is False:
                continue
            name = str(prop.get('propertyText') or '').strip()
            value = str(prop.get('actualValueText') or prop.get('valueText') or '').strip()
            if name and value:
                properties.append({'name': name, 'value': value})

        sku_id = sku.get('skuId')
        if sku_id is None or not properties:
            continue

        price_cent = sku.get('priceInCent')
        if price_cent is None:
            price_cent = sku.get('price')
        try:
            price_cent = int(price_cent) if price_cent is not None else None
        except (TypeError, ValueError):
            price_cent = None

        try:
            quantity = int(sku.get('quantity')) if sku.get('quantity') is not None else None
        except (TypeError, ValueError):
            quantity = None

        normalized.append({
            'sku_id': str(sku_id),
            'properties': properties,
            'display_name': ' / '.join(f"{prop['name']}: {prop['value']}" for prop in properties),
            'price_cent': price_cent,
            'quantity': quantity,
            '_order': int((sku.get('features') or {}).get('sku_order_num', len(normalized))),
        })

    normalized.sort(key=lambda sku: sku.pop('_order'))
    return normalized


async def fetch_item_skus(cookie_string: str, item_id: str, timeout: int = 30) -> List[Dict[str, Any]]:
    """从闲鱼商品详情接口读取完整的多维 SKU 快照。"""
    fetcher = OrderDetailFetcher(cookie_string, headless=True)
    loop = asyncio.get_running_loop()
    detail_payload = loop.create_future()

    async def capture_detail(response):
        if DETAIL_API_PATH not in response.url or detail_payload.done():
            return
        try:
            payload = await response.json()
            if not detail_payload.done():
                detail_payload.set_result(payload)
        except Exception as e:
            if not detail_payload.done():
                detail_payload.set_exception(e)

    try:
        if not await fetcher.init_browser():
            raise RuntimeError('浏览器初始化失败')
        fetcher.page.on('response', lambda response: asyncio.create_task(capture_detail(response)))
        await fetcher.page.goto(
            f'https://www.goofish.com/item?id={item_id}',
            wait_until='networkidle',
            timeout=timeout * 1000,
        )
        payload = await asyncio.wait_for(detail_payload, timeout=10)
        skus = normalize_item_skus(payload, item_id)
        logger.info(f'商品 SKU 同步成功: item_id={item_id}, sku_count={len(skus)}')
        return skus
    finally:
        await fetcher.close()
