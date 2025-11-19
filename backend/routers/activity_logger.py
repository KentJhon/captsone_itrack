# backend/activity_logger.py
import logging
from datetime import datetime
from typing import Any

from mysql.connector import IntegrityError  # 👈 add this
from db import get_db


def log_activity(user_id: Any, action: str, description: str) -> None:
    """
    Insert a row into activity_logs.

    If user_id is None or invalid, we store NULL so it doesn't violate
    the foreign key constraint and will be treated as "System" in the UI.
    """

    # 🔹 Convert user_id safely; use None (NULL) when invalid / missing
    try:
        uid = int(user_id) if user_id is not None else None
    except (TypeError, ValueError):
        uid = None

    conn = None
    cur = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO activity_logs (user_id, action, description, timestamp)
            VALUES (%s, %s, %s, %s)
            """,
            (uid, action, description, datetime.now()),
        )
        conn.commit()

    except IntegrityError as e:
        # FK constraint failed – most likely user_id doesn't exist.
        # We log it but don't crash the main request.
        logging.warning("Failed to log activity due to FK constraint: %s", e)

    except Exception as e:
        logging.exception("Failed to log activity: %s", e)

    finally:
        if cur is not None:
            try:
                cur.close()
            except Exception:
                pass
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
