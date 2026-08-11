import argparse
import json
import os
import sqlite3


MAPPINGS = (
    ('微伴 Lite 月卡', 'Lite-月卡', 'lite_month'),
    ('微伴 Lite 季卡', 'Lite-季卡', 'lite_quarter'),
    ('微伴 Lite 年卡', 'Lite-年卡', 'lite_year'),
    ('微伴 Pro 月卡', 'Pro-月卡', 'pro_month'),
    ('微伴 Pro 季卡', 'Pro-季卡', 'pro_quarter'),
    ('微伴 Pro 年卡', 'Pro-年卡', 'pro_year'),
)


def configure(db_path: str, user_id: int, keyword: str) -> None:
    con = sqlite3.connect(db_path)
    try:
        con.execute('BEGIN IMMEDIATE')
        card_ids = []
        description = '您的微伴会员兑换码：{DELIVERY_CONTENT}\n请妥善保管并尽快兑换。'

        for name, spec_value, sku in MAPPINGS:
            api_config = json.dumps(
                {'provider': 'weiban_redemption', 'sku': sku},
                ensure_ascii=False,
                separators=(',', ':'),
            )
            row = con.execute('''
                SELECT id FROM cards
                WHERE user_id = ? AND type = 'api' AND api_config = ?
            ''', (user_id, api_config)).fetchone()
            if row:
                card_id = row[0]
                con.execute('''
                    UPDATE cards
                    SET name = ?, description = ?, enabled = 1, delay_seconds = 0,
                        is_multi_spec = 1, spec_name = 'Lyvu', spec_value = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND user_id = ?
                ''', (name, description, spec_value, card_id, user_id))
            else:
                cursor = con.execute('''
                    INSERT INTO cards
                    (name, type, api_config, description, enabled, delay_seconds,
                     is_multi_spec, spec_name, spec_value, user_id)
                    VALUES (?, 'api', ?, ?, 1, 0, 1, 'Lyvu', ?, ?)
                ''', (name, api_config, description, spec_value, user_id))
                card_id = cursor.lastrowid
            card_ids.append(card_id)

            rule = con.execute('''
                SELECT id FROM delivery_rules
                WHERE user_id = ? AND keyword = ? AND card_id = ?
            ''', (user_id, keyword, card_id)).fetchone()
            if rule:
                con.execute('''
                    UPDATE delivery_rules
                    SET enabled = 1, delivery_count = 1,
                        description = '闲鱼付款后调用微伴接口自动发货',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND user_id = ?
                ''', (rule[0], user_id))
            else:
                con.execute('''
                    INSERT INTO delivery_rules
                    (keyword, card_id, user_id, delivery_count, enabled, description)
                    VALUES (?, ?, ?, 1, 1, '闲鱼付款后调用微伴接口自动发货')
                ''', (keyword, card_id, user_id))

        placeholders = ','.join('?' for _ in card_ids)
        con.execute(f'''
            UPDATE delivery_rules
            SET enabled = 0, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND keyword = ? AND card_id NOT IN ({placeholders})
        ''', (user_id, keyword, *card_ids))

        active = con.execute(f'''
            SELECT COUNT(*) FROM delivery_rules dr
            JOIN cards c ON c.id = dr.card_id
            WHERE dr.user_id = ? AND dr.keyword = ? AND dr.enabled = 1
              AND c.enabled = 1 AND c.type = 'api'
              AND c.spec_name = 'Lyvu' AND c.id IN ({placeholders})
        ''', (user_id, keyword, *card_ids)).fetchone()[0]
        if active != len(MAPPINGS):
            raise RuntimeError(f'expected {len(MAPPINGS)} active mappings, got {active}')

        con.commit()
        print(f'configured={active}')
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', default=os.getenv('DB_PATH', '/app/data/xianyu_data.db'))
    parser.add_argument('--user-id', type=int, required=True)
    parser.add_argument('--keyword', required=True)
    args = parser.parse_args()
    configure(args.db, args.user_id, args.keyword)
