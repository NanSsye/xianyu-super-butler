"""同一闲鱼账号的人工登录与后台自动恢复互斥。"""

import threading


_lock = threading.Lock()
_manual_login_accounts = set()


def begin_manual_login(account_id: str) -> None:
    with _lock:
        _manual_login_accounts.add(str(account_id))


def end_manual_login(account_id: str) -> None:
    with _lock:
        _manual_login_accounts.discard(str(account_id))


def is_manual_login_active(account_id: str) -> bool:
    with _lock:
        return str(account_id) in _manual_login_accounts
