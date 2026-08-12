from utils.order_detail_fetcher import OrderDetailFetcher


def test_parses_sku_from_order_api_string_payload():
    payload = {
        "ret": ["SUCCESS::调用成功"],
        "data": '{"itemInfo":{"skuInfo":"Lyvu:Lite-月卡","buyAmount":"2"},'
                '"priceInfo":{"amount":{"value":"29.90"}}}',
    }

    result = OrderDetailFetcher()._parse_order_api_response(payload)

    assert result == {
        "spec_name": "Lyvu",
        "spec_value": "Lite-月卡",
        "quantity": "2",
        "amount": "29.90",
    }


def test_marks_expired_order_web_session():
    payload = {"ret": ["FAIL_SYS_SESSION_EXPIRED::Session过期"], "data": {}}

    assert OrderDetailFetcher()._parse_order_api_response(payload) == {
        "auth_error": "session_expired"
    }
