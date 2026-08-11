import asyncio
import unittest
from collections import defaultdict
from unittest.mock import AsyncMock, patch

from XianyuAutoAsync import XianyuLive


class FakeDB:
    def get_order_by_id(self, _order_id):
        return {}


class PaidOrderUpdateTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.live = XianyuLive.__new__(XianyuLive)
        self.live.cookie_id = 'account'
        self.live._order_detail_locks = defaultdict(lambda: asyncio.Lock())
        self.live._handle_auto_delivery = AsyncMock()
        self.message = {
            '2': 'chat-id@goofish',
            '4': {
                'reminderContent': '[已付款，待发货]',
                'senderUserId': 'buyer-id',
                'reminderUrl': 'fleamarket://message_chat?itemId=item-id&peerUserId=buyer-id',
            },
        }

    def test_detects_paid_incremental_update(self):
        self.assertTrue(self.live._is_paid_order_update_event(self.message))
        self.assertFalse(
            self.live._is_paid_order_update_event(
                {'4': {'reminderContent': '[我已拍下，待付款]'}}
            )
        )

    async def test_routes_paid_update_to_auto_delivery_with_recovered_context(self):
        with patch('XianyuAutoAsync.db_manager', FakeDB()):
            handled = await self.live._handle_paid_order_update(
                websocket='ws',
                message=self.message,
                order_id='order-id',
                msg_time='now',
            )

        self.assertTrue(handled)
        self.live._handle_auto_delivery.assert_awaited_once_with(
            'ws', self.message, '买家', 'buyer-id', 'item-id', 'chat-id', 'now'
        )


if __name__ == '__main__':
    unittest.main()
