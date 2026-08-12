import json
import os
import sqlite3
import tempfile
import unittest


_IMPORT_DB = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
_IMPORT_DB.close()
os.environ['DB_PATH'] = _IMPORT_DB.name

from db_manager import DBManager, db_manager as _GLOBAL_DB  # noqa: E402


class DeliveryRuleBindingTests(unittest.TestCase):
    def setUp(self):
        handle = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
        handle.close()
        self.db_path = handle.name
        self.db = DBManager(self.db_path)
        cursor = self.db.conn.cursor()
        cursor.execute(
            "INSERT INTO users (id, username, email, password_hash) VALUES (1, 'u', 'u@test', 'x')"
        )
        cursor.execute(
            "INSERT INTO cookies (id, value, user_id) VALUES ('account', 'cookie', 1)"
        )
        cursor.execute(
            "INSERT INTO cards (id, name, type, text_content, user_id) "
            "VALUES (1, 'Pro 月卡', 'text', 'code', 1)"
        )
        cursor.execute(
            "INSERT INTO item_info (cookie_id, item_id, item_title, is_multi_spec) "
            "VALUES ('account', 'item-1', '会员商品', 1)"
        )
        self.db.conn.commit()
        self.db.replace_item_skus('account', 'item-1', [{
            'sku_id': 'sku-pro-month',
            'properties': [{'name': 'Lyvu', 'value': 'Pro-月卡'}],
            'display_name': 'Lyvu: Pro-月卡',
            'price_cent': 5990,
            'quantity': 10,
        }])

    def tearDown(self):
        self.db.conn.close()
        os.unlink(self.db_path)

    def create_bound_rule(self, enabled=True):
        return self.db.create_delivery_rule(
            keyword='会员商品',
            card_id=1,
            user_id=1,
            cookie_id='account',
            item_id='item-1',
            sku_id='sku-pro-month',
            sku_properties_json=json.dumps(
                [{'name': 'Lyvu', 'value': 'Pro-月卡'}], ensure_ascii=False
            ),
            sku_display_name='Lyvu: Pro-月卡',
            enabled=enabled,
        )

    def test_matches_only_the_bound_item_and_spec(self):
        self.create_bound_rule()

        self.assertTrue(self.db.has_delivery_rule_bindings('account', 'item-1'))
        rules = self.db.get_delivery_rules_by_item(
            'account', 'item-1', 'Lyvu', 'Pro-月卡'
        )
        self.assertEqual(1, len(rules))
        self.assertEqual('sku-pro-month', rules[0]['sku_id'])
        self.assertEqual([], self.db.get_delivery_rules_by_item(
            'account', 'item-1', 'Lyvu', 'Lite-月卡'
        ))
        self.assertEqual([], self.db.get_delivery_rules_by_keyword('会员商品'))

    def test_disabled_binding_blocks_legacy_fallback(self):
        self.create_bound_rule(enabled=False)

        self.assertTrue(self.db.has_delivery_rule_bindings('account', 'item-1'))
        self.assertEqual([], self.db.get_delivery_rules_by_item(
            'account', 'item-1', 'Lyvu', 'Pro-月卡'
        ))

    def test_duplicate_item_sku_binding_is_rejected(self):
        self.create_bound_rule()
        with self.assertRaises(sqlite3.IntegrityError):
            self.create_bound_rule()


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        _GLOBAL_DB.conn.close()
        if os.path.exists(_IMPORT_DB.name):
            os.unlink(_IMPORT_DB.name)
